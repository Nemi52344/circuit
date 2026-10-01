import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

/* ChatGPT's carousel plan: the hook slide, the middle slides and the call to action. */
export const POST = handle(async (req) => {
  const b = await readJson<{ job_id?: string; slides?: { headline?: string; body?: string; image_idea?: string }[] }>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT slot_id, kind FROM research_jobs WHERE id = ?").get(b.job_id) as { slot_id: string; kind: string } | undefined;
  if (!job || job.kind !== "slides") return bad("Slides job not found", 404);
  const list = (b.slides || []).filter((s) => s?.headline?.trim() || s?.body?.trim()).slice(0, 10);
  if (list.length < 3) return bad("A carousel needs at least 3 slides");
  // a fresh plan replaces slides nobody has given an image yet; designed slides are kept
  db.prepare("DELETE FROM slot_slides WHERE slot_id = ? AND file_id IS NULL").run(job.slot_id);
  const start = (db.prepare("SELECT COALESCE(MAX(position), -1) p FROM slot_slides WHERE slot_id = ?").get(job.slot_id) as { p: number }).p + 1;
  const ins = db.prepare("INSERT INTO slot_slides (id, slot_id, position, headline, body, image_idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  list.forEach((s, i) => ins.run(newId(), job.slot_id, start + i, (s.headline || "").trim().slice(0, 120), (s.body || "").trim().slice(0, 400), (s.image_idea || "").trim().slice(0, 300), now(), now()));
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ slides: list.length });
});
