import { getDb, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

type Draft = { platform?: string; caption?: string; hashtags?: string; title?: string; label?: string };

/* Claude's captions land as drafts on the slot. Saved copy in slot_content is never touched:
   the owner reviews each draft and saves it. */
export const POST = handle(async (req) => {
  const b = await readJson<{ job_id?: string; posts?: Draft[] }>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT slot_id, kind FROM research_jobs WHERE id = ?").get(b.job_id) as { slot_id: string; kind: string } | undefined;
  if (!job || job.kind !== "copy") return bad("Copy job not found", 404);
  const slot = db.prepare("SELECT platforms, research FROM slots WHERE id = ?").get(job.slot_id) as { platforms: string; research: string } | undefined;
  if (!slot) return bad("Slot not found", 404);
  const platforms: string[] = JSON.parse(slot.platforms || "[]");
  // several options per platform, in the order they arrive
  const drafts: Record<string, { caption: string; hashtags: string; title: string; label: string }[]> = {};
  for (const p of b.posts || []) {
    if (!p?.platform || !platforms.includes(p.platform) || !p.caption?.trim()) continue;
    const list = (drafts[p.platform] ||= []);
    if (list.length >= 4) continue;
    list.push({ caption: p.caption.trim(), hashtags: (p.hashtags || "").trim(), title: (p.title || "").trim(), label: (p.label || "").trim().slice(0, 40) });
  }
  if (!Object.keys(drafts).length) return bad(`Deliver a caption for at least one of: ${platforms.join(", ")}`);
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
  research = { ...research, copy_drafts: drafts, copy_written_at: now() };
  db.prepare("UPDATE slots SET research = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(research), now(), job.slot_id);
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ slot_id: job.slot_id, platforms: Object.keys(drafts), options: Object.values(drafts).reduce((a, x) => a + x.length, 0) });
});
