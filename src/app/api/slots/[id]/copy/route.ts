import { handle, ok, bad } from "@/lib/http";
import { startCopy } from "@/lib/research";

import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
// queuing work wakes the automatic worker
startWorker();

/* Queue Claude to write captions for every platform on this slot. */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  try {
    return ok(startCopy(id), 201);
  } catch (e) {
    return bad((e as Error).message);
  }
});
