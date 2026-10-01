import { handle, ok, bad } from "@/lib/http";
import { startResearch } from "@/lib/research";

import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
// queuing work wakes the automatic worker
startWorker();
export const maxDuration = 60;

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  try {
    return ok(await startResearch(id), 201);
  } catch (e) {
    return bad((e as Error).message);
  }
});
