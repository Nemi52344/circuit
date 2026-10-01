import { handle, ok, readJson } from "@/lib/http";
import { queueTopicIdeas } from "@/lib/research";

import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
// queuing work wakes the automatic worker
startWorker();

/* Ask Claude for topic ideas on every upcoming post that has none. Idempotent. */
export const POST = handle(async (req) => {
  const b = await readJson<{ slot_id?: string }>(req).catch(() => ({} as { slot_id?: string }));
  return ok(queueTopicIdeas(14, b.slot_id || undefined));
});
