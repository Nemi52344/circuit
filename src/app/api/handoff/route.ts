import { randomBytes } from "node:crypto";
import { handle, ok, readJson } from "@/lib/http";
import { getDb, setSetting } from "@/lib/db";
import { handoffSecret, dueForHandoff, HANDOFF_PLATFORMS } from "@/lib/handoff";

export const runtime = "nodejs";

/* Turning the hand-over on and off, and saying plainly what it exposes.

   The key is shown in full exactly once, when it is made. Circuit has to keep it to check the
   next request, so this is not a password store pretending otherwise — it is simply that a key
   left on screen is a key read over a shoulder. Making a new one invalidates the old. */

export const GET = handle(async () => {
  const secret = handoffSecret();
  return ok({
    on: Boolean(secret),
    platforms: HANDOFF_PLATFORMS,
    waiting: secret ? dueForHandoff().length : 0,
    /* Said out loud on the page, because the whole point of this endpoint is that it is
       narrower than the app it lives in, and nobody should have to read the source to know. */
    exposes: [
      `What is waiting on ${HANDOFF_PLATFORMS.join(" and ")} — caption, date, how late`,
      "One post's caption and a public link to its picture",
      "A way to record the live URL once it has gone out",
    ],
    withholds: [
      "Instagram and Facebook — Circuit publishes those itself",
      "Your Meta token, Higgsfield keys and every other secret",
      "Bills, card statements and what marketing costs",
      "Brand settings, knowledge, intel and the rest of the app",
    ],
  });
});

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string }>(req);

  if (b.action === "off") {
    getDb().prepare("DELETE FROM settings WHERE key = 'handoff_secret'").run();
    return ok({ on: false });
  }

  /* 32 random bytes. Long enough that guessing is not a strategy. */
  const key = randomBytes(32).toString("base64url");
  setSetting("handoff_secret", key);
  return ok({ on: true, key });
});
