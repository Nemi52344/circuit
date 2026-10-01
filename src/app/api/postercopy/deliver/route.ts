import { getDb, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

/* ChatGPT's lines for the picture itself. Saved as suggestions on the slot; nothing is put on
   an image until the owner picks one. */
export const POST = handle(async (req) => {
  const b = await readJson<{ job_id?: string; lines?: { line?: string; style?: string; note?: string; sub?: string }[] }>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT slot_id, kind FROM research_jobs WHERE id = ?").get(b.job_id) as { slot_id: string; kind: string } | undefined;
  if (!job || job.kind !== "postercopy") return bad("Poster copy job not found", 404);
  const lines = (b.lines || [])
    .filter((l) => l?.line?.trim())
    .slice(0, 10)
    .map((l) => ({ line: l.line!.trim().slice(0, 90), sub: (l.sub || "").trim().slice(0, 120), style: (l.style || "").trim().slice(0, 40), note: (l.note || "").trim().slice(0, 160) }));
  if (lines.length < 5) return bad("Give at least 5 lines");

  const row = db.prepare("SELECT research FROM slots WHERE id = ?").get(job.slot_id) as { research: string } | undefined;
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(row?.research || "{}"); } catch { research = {}; }
  research.poster_copy = lines;
  research.poster_copy_at = now();
  db.prepare("UPDATE slots SET research = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(research), now(), job.slot_id);
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ lines: lines.length });
});
