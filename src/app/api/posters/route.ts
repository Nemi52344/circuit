import { handle, ok, readJson } from "@/lib/http";
import { posterLearned } from "@/lib/posterlearn";
import { tagPosters, postersLeft } from "@/lib/postertags";

export const runtime = "nodejs";
export const maxDuration = 600;

export const GET = handle(async () => ok({ ...posterLearned(), left: postersLeft() }));

/* "Look at my posters" — ChatGPT describes a handful at a time, so the run stays short. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; batch?: number }>(req);
  if (b.action === "tag") {
    const r = await tagPosters(Math.min(Math.max(b.batch || 6, 1), 10));
    return ok({ ...posterLearned(), left: postersLeft(), run: r });
  }
  return ok({ ...posterLearned(), left: postersLeft() });
});
