import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import { waitingForSignoff, signedOff, decide, type Decision } from "@/lib/signoff";

export const runtime = "nodejs";

/* The sign-off queue: what is waiting to be looked at, and what has already cleared. */

export const GET = handle(async () => {
  const waiting = waitingForSignoff();
  return ok({
    waiting,
    cleared: signedOff(),
    /* Called out separately because it is the case people get caught by: it had a yes, then the
       words moved, so the yes no longer covers what would actually go out. */
    stale: waiting.filter((w) => w.stale).length,
  });
});

export const POST = handleCan("approve", async (req, user) => {
  const b = await readJson<{ id?: string; decision?: Decision; note?: string }>(req);
  if (!b.id) return bad("id required");
  if (b.decision !== "approved" && b.decision !== "rejected") return bad("Say approved or rejected");
  return ok(decide(b.id, user, b.decision, b.note || ""));
});
