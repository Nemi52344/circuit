import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad } from "@/lib/http";
import { approvalSummary } from "@/lib/approvals";

export const runtime = "nodejs";

type Slot = { id: string; date: string; time: string; format: string; final_creation_id: string | null };
type Content = { id: string; platform: string; caption: string; meta: string; scheduled_at: string; post_id: string | null };

/* Stage 8: every platform's copy becomes a scheduled post on the calendar, bound to the approved image.
   Circuit still never posts by itself; the post is marked posted later with its live link. */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const db = getDb();
  const slot = db.prepare("SELECT * FROM slots WHERE id = ?").get(id) as Slot | undefined;
  if (!slot) return bad("Slot not found", 404);
  const final = slot.final_creation_id ? (db.prepare("SELECT id, file_id FROM creations WHERE id = ?").get(slot.final_creation_id) as { id: string; file_id: string } | undefined) : undefined;
  if (!final && slot.format !== "text") return bad("Approve a final image in stage 6 first");
  const content = db.prepare("SELECT * FROM slot_content WHERE slot_id = ?").all(id) as Content[];
  if (!content.length) return bad("Write copy for at least one platform in stage 7");
  // nothing goes on the calendar until every required person has signed off this exact version
  const sign = approvalSummary(id);
  if (!sign.ready) return bad(`Waiting for sign-off from ${sign.missing.join(", ")}`, 409);

  const created: string[] = [];
  for (const c of content) {
    let meta: Record<string, string> = {};
    try { meta = JSON.parse(c.meta || "{}"); } catch { meta = {}; }
    const caption = [c.caption, meta.hashtags].filter(Boolean).join("\n\n");
    const when = c.scheduled_at || new Date(`${slot.date}T${slot.time || "10:00"}:00`).toISOString();
    if (c.post_id && db.prepare("SELECT id FROM posts WHERE id = ?").get(c.post_id)) {
      db.prepare("UPDATE posts SET caption = ?, file_id = ?, creation_id = ?, scheduled_at = ?, updated_at = ? WHERE id = ? AND status != 'posted'")
        .run(caption, final?.file_id ?? null, final?.id ?? null, when, now(), c.post_id);
    } else {
      const pid = newId();
      db.prepare(
        `INSERT INTO posts (id, platform, caption, file_id, creation_id, scheduled_at, status, posted_url, notes, slot_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled', '', ?, ?, ?, ?)`,
      ).run(pid, c.platform, caption, final?.file_id ?? null, final?.id ?? null, when, meta.link ? `Link: ${meta.link}` : "", id, now(), now());
      db.prepare("UPDATE slot_content SET post_id = ?, updated_at = ? WHERE id = ?").run(pid, now(), c.id);
      created.push(pid);
    }
  }
  if (final) db.prepare("UPDATE creations SET status = 'approved' WHERE id = ?").run(final.id);
  db.prepare("UPDATE slots SET stage = 8, status = 'scheduled', updated_at = ? WHERE id = ?").run(now(), id);
  return ok({ scheduled: content.length, created: created.length });
});
