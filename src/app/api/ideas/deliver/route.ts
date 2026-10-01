import { getDb, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { cleanIdeas, type Idea } from "@/lib/conversation";

export const runtime = "nodejs";

/* Claude's ideas for a whole month: 3 per open post. Posts that got a topic meanwhile are skipped. */
export const POST = handle(async (req) => {
  const b = await readJson<{ job_id?: string; slots?: { slot_id?: string; ideas?: Idea[] }[] }>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT kind FROM research_jobs WHERE id = ?").get(b.job_id) as { kind: string } | undefined;
  if (!job || job.kind !== "ideas") return bad("Ideas job not found", 404);
  let filled = 0;
  const skipped: string[] = [];
  for (const s of b.slots || []) {
    const ideas = cleanIdeas(s.ideas);
    if (!s.slot_id || !ideas.length) continue;
    const row = db.prepare("SELECT topic, research FROM slots WHERE id = ?").get(s.slot_id) as { topic: string; research: string } | undefined;
    if (!row || row.topic.trim()) { skipped.push(s.slot_id); continue; }
    let research: Record<string, unknown> = {};
    try { research = JSON.parse(row.research || "{}"); } catch { research = {}; }
    research = { ...research, topic_ideas: ideas, topic_ideas_at: now() };
    db.prepare("UPDATE slots SET research = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(research), now(), s.slot_id);
    filled++;
  }
  if (!filled && !skipped.length) return bad("Deliver ideas for at least one post");
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ filled, skipped: skipped.length });
});
