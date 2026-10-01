import { handle, ok, bad, readJson } from "@/lib/http";
import { queueMonthIdeas } from "@/lib/conversation";

import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
// queuing work wakes the automatic worker
startWorker();
export const maxDuration = 120;

/* Gather the month's conversation and ask Claude for topic ideas on every open post. Idempotent. */
export const POST = handle(async (req) => {
  const b = await readJson<{ month?: string; force?: boolean }>(req);
  if (!b.month || !/^\d{4}-\d{2}$/.test(b.month)) return bad("month must look like 2026-10");
  return ok(await queueMonthIdeas(b.month, Boolean(b.force)));
});
