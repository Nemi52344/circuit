import { getDb, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { cleanIdeas, type Idea } from "@/lib/conversation";

export const runtime = "nodejs";

/* Claude's topic ideas for one slot. The owner picks one; the topic itself is never set here. */
export const POST = handle(async (req) => {
  const b = await readJson<{ job_id?: string; ideas?: Idea[] }>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT slot_id, kind FROM research_jobs WHERE id = ?").get(b.job_id) as { slot_id: string; kind: string } | undefined;
  if (!job || job.kind !== "topics") return bad("Topic job not found", 404);
  const ideas = cleanIdeas(b.ideas);
  if (!ideas.length) return bad("Deliver at least one topic idea");
  const slot = db.prepare("SELECT research FROM slots WHERE id = ?").get(job.slot_id) as { research: string } | undefined;
  if (!slot) return bad("Slot not found", 404);
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
  research = { ...research, topic_ideas: ideas, topic_ideas_at: now() };
  db.prepare("UPDATE slots SET research = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(research), now(), job.slot_id);
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ slot_id: job.slot_id, ideas: ideas.length });
});
