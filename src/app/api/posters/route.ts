import { handle, ok, bad, readJson } from "@/lib/http";
import { posterLearned, judged, setVerdict, type Verdict } from "@/lib/posterlearn";
import { tagPosters, postersLeft } from "@/lib/postertags";

export const runtime = "nodejs";
export const maxDuration = 600;

export const GET = handle(async () => ok({ ...posterLearned(), left: postersLeft(), judged: judged() }));

/* "Look at my posters" — ChatGPT describes a handful at a time, so the run stays short. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; batch?: number; id?: string; verdict?: string; why?: string }>(req);
  /* Keeping a post as a model, or setting it aside so it stops shaping the advice. */
  if (b.action === "verdict") {
    try {
      setVerdict(b.id || "", (b.verdict || "") as Verdict, b.why || "");
      return ok({ ...posterLearned(), left: postersLeft(), judged: judged() });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (b.action === "tag") {
    const r = await tagPosters(Math.min(Math.max(b.batch || 6, 1), 10));
    return ok({ ...posterLearned(), left: postersLeft(), run: r });
  }
  return ok({ ...posterLearned(), left: postersLeft() });
});
