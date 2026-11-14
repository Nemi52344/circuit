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

/* HttpOnly keeps it away from page scripts; SameSite=Lax stops another site spending it on a
   request to Circuit. Secure when the person came in over https — through the tunnel, which
   says so in X-Forwarded-Proto — and not on http://localhost, where a Secure cookie would
   simply never be set. */
const viaHttps = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
const cookie = (req: Request, token: string, maxAge: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${viaHttps(req) ? "; Secure" : ""}`;

/* Guessing. Once Circuit is reachable from the internet, anyone can try passwords, so ten
   misses for one email from one address, or fifty from one address, stops that address for
   fifteen minutes. The address is Cloudflare's report of the real visitor, which the visitor
   cannot set; on this computer there is no such header and everything counts as "local". */
const WINDOW = 15 * 60 * 1000;
const misses = new Map<string, { n: number; first: number }>();
const missKeys = (req: Request, email: string) => {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  return [`${ip}|${email.trim().toLowerCase()}`, ip];
};
function tooMany(keys: string[]): boolean {
  return keys.some((k, i) => {
    const m = misses.get(k);
    if (!m) return false;
    if (Date.now() - m.first > WINDOW) { misses.delete(k); return false; }
    return m.n >= (i === 0 ? 10 : 50);
  });
}
function missed(keys: string[]) {
  for (const k of keys) {
    const m = misses.get(k);
    if (!m || Date.now() - m.first > WINDOW) misses.set(k, { n: 1, first: Date.now() });
    else m.n++;
  }
}
/* Runs a password check under the limit; a success clears that email's count. */
function guarded<T>(req: Request, email: string, attempt: () => T): T | Response {
  const keys = missKeys(req, email);
  if (tooMany(keys)) return bad("Too many tries — wait fifteen minutes and try again", 429);
  try {
    const r = attempt();
    misses.delete(keys[0]);
    return r;
  } catch (e) {
    missed(keys);
    return bad((e as Error).message, 401);
  }
}

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
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, token, THIRTY_DAYS) },
    });
  }

  /* Locked out. Asking for a code says nothing about whether the account exists — the answer is
     the same either way — because this route is open and anyone who can reach the port could
     otherwise use it to find out who works here. The code itself only ever appears on this computer. */
  if (b.action === "recover") {
    requestRecovery(b.email || "");
    return ok({ asked: true, where: "data/recovery-code.txt" });
  }

  if (b.action === "recover-confirm") {
    const done = guarded(req, b.email || "", () => completeRecovery(b.email || "", b.code || "", b.password || ""));
    if (done instanceof Response) return done;
    const user = done;
    /* Straight back in, rather than bouncing them to a sign-in form to retype what they just set. */
    const { token } = signIn(user.email, b.password || "");
    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, token, THIRTY_DAYS) },
    });
  }

  if (b.action === "out") {
    const raw = req.headers.get("cookie") || "";
    const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
    if (hit) signOut(decodeURIComponent(hit.slice(COOKIE.length + 1)));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, "", 0) },
    });
  }

  const signed = guarded(req, b.email || "", () => signIn(b.email || "", b.password || ""));
  if (signed instanceof Response) return signed;
  const { token, user } = signed;
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, token, THIRTY_DAYS) },
  });
});

/* Who is on the system. Visible to anyone signed in — knowing your colleagues' names is not a
   secret, and the sign-off queue has to show who approved what. No password material is here. */
export const PUT = handle(async () => ok({ users: listUsers() }));
