import { handle, ok, readJson } from "@/lib/http";
import { workerState, setWorkerEnabled, startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";

export const GET = handle(async () => {
  startWorker();
  return ok(workerState());
});

export const POST = handle(async (req) => {
  const b = await readJson<{ enabled?: boolean; run?: boolean }>(req);
  startWorker();
  if (typeof b.enabled === "boolean") setWorkerEnabled(b.enabled);
  if (b.run) kickWorker();
  return ok(workerState());
});
