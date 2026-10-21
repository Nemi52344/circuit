import { handle, ok, bad, readJson } from "@/lib/http";
import {
  COOKIE, anyUsers, createUser, signIn, signOut, userForRequest, listUsers, sweepSessions,
  requestRecovery, completeRecovery, type Role,
} from "@/lib/auth";

export const runtime = "nodejs";

/* Signing in, signing out, and the very first account.

   Circuit has always run on one Mac for one person, so this is not a sign-up page — there is no
   open registration and never will be. The first account is made once, by whoever is at the
   machine, and after that only an owner adds people. */

const THIRTY_DAYS = 60 * 60 * 24 * 30;

const cookie = (token: string, maxAge: number) =>
  /* HttpOnly keeps it away from page scripts; SameSite=Lax stops another site spending it on a
     request to Circuit. Secure is left off because this runs on http://localhost today and a
     Secure cookie would simply never be set — it belongs here the day there is a tunnel. */
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

export const GET = handle(async (req) => {
  sweepSessions();
  const user = userForRequest(req);
  /* The login screen needs to know whether to ask for a password or offer to make the first
     account. It is told that and nothing else — never whether a given email exists. */
  return ok({ user, setup_needed: !anyUsers() });
});

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; email?: string; password?: string; name?: string; code?: string; role?: Role }>(req);

  if (b.action === "setup") {
    if (anyUsers()) return bad("Circuit already has accounts — ask the owner to add you", 403);
    /* The first account is always the owner. Anything else leaves nobody who can sign off, and
       nobody who can hand out accounts. */
    const user = createUser({ name: b.name || "", email: b.email || "", role: "owner", password: b.password || "" });
    const { token } = signIn(user.email, b.password || "");
    return new Response(JSON.stringify({ user }), {
      status: 201,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie(token, THIRTY_DAYS) },
    });
  }

  /* Locked out. Asking for a code says nothing about whether the account exists — the answer is
     the same either way — because this route is open and anyone who can reach the port could
     otherwise use it to find out who works here. The code itself only ever appears on this Mac. */
  if (b.action === "recover") {
    requestRecovery(b.email || "");
    return ok({ asked: true, where: "data/recovery-code.txt" });
  }

  if (b.action === "recover-confirm") {
    const user = completeRecovery(b.email || "", b.code || "", b.password || "");
    /* Straight back in, rather than bouncing them to a sign-in form to retype what they just set. */
    const { token } = signIn(user.email, b.password || "");
    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie(token, THIRTY_DAYS) },
    });
  }

  if (b.action === "out") {
    const raw = req.headers.get("cookie") || "";
    const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
    if (hit) signOut(decodeURIComponent(hit.slice(COOKIE.length + 1)));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie("", 0) },
    });
  }

  const { token, user } = signIn(b.email || "", b.password || "");
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie(token, THIRTY_DAYS) },
  });
});

/* Who is on the system. Visible to anyone signed in — knowing your colleagues' names is not a
   secret, and the sign-off queue has to show who approved what. No password material is here. */
export const PUT = handle(async () => ok({ users: listUsers() }));
