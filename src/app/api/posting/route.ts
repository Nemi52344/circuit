import { getDb } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

/* Everything needed to actually put a post out, in one place.

   Circuit does not publish to LinkedIn or X — neither will hand an outsider that power without
   a partner agreement or a paid tier. So this is the hand-over: the picture, the words, and
   somewhere to put the link once it is live. It is the same data whether a person posts it or a
   browser is driven through the form, which is why it lives behind an endpoint rather than only
   on a page. */

export type Ready = {
  id: string; platform: string; when: string; caption: string; notes: string;
  image_file_id: string | null; image_url: string | null;
  slot_id: string | null; topic: string; late: boolean; status: string;
};

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const days = Math.min(Number(u.searchParams.get("days") || 7), 60);
  const all = u.searchParams.get("all") === "1";
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  const rows = getDb().prepare(`
    SELECT p.id, p.platform, p.scheduled_at, p.caption, p.notes, p.status, p.slot_id,
           COALESCE(p.file_id, c.file_id) AS image_file_id, s.topic
    FROM posts p
    LEFT JOIN creations c ON c.id = p.creation_id
    LEFT JOIN slots s ON s.id = p.slot_id
    WHERE p.status != 'posted' ${all ? "" : "AND substr(p.scheduled_at, 1, 10) <= ?"}
    ORDER BY p.scheduled_at`).all(...(all ? [] : [until])) as (Ready & { scheduled_at: string })[];

  const ready: Ready[] = rows.map((r) => ({
    id: r.id, platform: r.platform, when: r.scheduled_at, caption: r.caption || "",
    notes: r.notes || "", status: r.status, slot_id: r.slot_id, topic: r.topic || "",
    image_file_id: r.image_file_id,
    image_url: r.image_file_id ? `/api/files/${r.image_file_id}` : null,
    late: r.scheduled_at.slice(0, 10) < today,
  }));
  return ok({ ready, late: ready.filter((r) => r.late).length, today });
});

/* Recording that it went out. The live URL is the whole point: without it there is no evidence
   the post exists, and nothing to hang its numbers on later. */
export const POST = handle(async (req) => {
  const b = await readJson<{ id?: string; posted_url?: string; caption?: string }>(req);
  if (!b.id) return bad("id required");
  const db = getDb();
  if (b.caption !== undefined) db.prepare("UPDATE posts SET caption = ?, updated_at = datetime('now') WHERE id = ?").run(b.caption, b.id);
  if (b.posted_url !== undefined) {
    const url = b.posted_url.trim();
    if (!url) return bad("Paste the live link — it is the evidence the post exists");
    if (!/^https?:\/\//i.test(url)) return bad("That does not look like a link");
    db.prepare("UPDATE posts SET status = 'posted', posted_url = ?, updated_at = datetime('now') WHERE id = ?").run(url, b.id);
  }
  return ok(db.prepare("SELECT id, platform, status, posted_url FROM posts WHERE id = ?").get(b.id));
});
