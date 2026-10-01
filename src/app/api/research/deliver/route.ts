import { getDb, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

type Angle = { angle: string; message: string; why?: string };
type Body = {
  job_id?: string; competitor?: string; market?: string; trends?: string; topic?: string;
  angles?: Angle[]; recommended_format?: string; sources?: { title: string; url: string }[]; keywords?: string[];
};

/* Claude's analysis lands here and becomes stage 2's content. Nothing the owner typed is overwritten. */
export const POST = handle(async (req) => {
  const b = await readJson<Body>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT slot_id, kind FROM research_jobs WHERE id = ?").get(b.job_id) as { slot_id: string; kind: string } | undefined;
  if (!job || job.kind === "copy") return bad("Research job not found", 404);
  const angles = (b.angles || []).filter((a) => a && a.angle?.trim() && a.message?.trim()).slice(0, 5);
  if (!angles.length) return bad("Deliver at least one angle with a key message");
  const format = ["image", "carousel", "video", "text"].includes(b.recommended_format || "") ? b.recommended_format : "image";

  const slot = db.prepare("SELECT research FROM slots WHERE id = ?").get(job.slot_id) as { research: string } | undefined;
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(slot?.research || "{}"); } catch { research = {}; }
  const merged = {
    ...research,
    summary_competitor: (b.competitor || "").trim(),
    summary_market: (b.market || "").trim(),
    summary_trends: (b.trends || "").trim(),
    summary_topic: (b.topic || "").trim(),
    angles,
    recommended_format: format,
    sources: (b.sources || []).filter((s) => s?.url).slice(0, 20),
    keywords: Array.from(new Set([...((research.keywords as string[] | undefined) || []), ...(Array.isArray(b.keywords) ? b.keywords : []).map((k) => String(k).trim().toLowerCase())].filter(Boolean))).slice(0, 16),
    analysed_at: now(),
  };
  db.prepare("UPDATE slots SET research = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), now(), job.slot_id);
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ slot_id: job.slot_id, angles: angles.length });
});
