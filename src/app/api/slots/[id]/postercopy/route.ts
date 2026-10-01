import { handle, ok } from "@/lib/http";
import { startPosterCopy } from "@/lib/research";
import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
startWorker();

/* Ask ChatGPT for the words that go on the picture itself. */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const r = startPosterCopy(id);
  kickWorker();
  return ok(r, 201);
});
