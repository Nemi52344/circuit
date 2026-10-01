import { getDb, getSetting } from "@/lib/db";
import { handle, ok } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const db = getDb();
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const nowIso = new Date().toISOString();
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString();
  return ok({
    has_key: Boolean(getSetting("gemini_key")),
    products: count("SELECT COUNT(*) n FROM products"),
    inspirations: count("SELECT COUNT(*) n FROM inspirations"),
    creations: count("SELECT COUNT(*) n FROM creations"),
    awaiting_approval: count("SELECT COUNT(*) n FROM creations WHERE status IN ('generated','saved')"),
    posts_draft: count("SELECT COUNT(*) n FROM posts WHERE status = 'draft'"),
    posts_week: count("SELECT COUNT(*) n FROM posts WHERE scheduled_at >= ? AND scheduled_at < ? AND status != 'posted'", nowIso, weekEnd),
    overdue: count("SELECT COUNT(*) n FROM posts WHERE scheduled_at < ? AND status IN ('approved','scheduled')", nowIso),
    posted_no_metrics: count(
      "SELECT COUNT(*) n FROM posts po WHERE po.status = 'posted' AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.post_id = po.id)",
    ),
    drafts: count("SELECT COUNT(*) n FROM drafts WHERE status = 'draft'"),
    upcoming: db
      .prepare(
        `SELECT po.id, po.platform, po.caption, po.scheduled_at, po.status, COALESCE(po.file_id, c.file_id) AS image_file_id
         FROM posts po LEFT JOIN creations c ON c.id = po.creation_id
         WHERE po.status != 'posted' ORDER BY po.scheduled_at LIMIT 8`,
      )
      .all(),
    recent_creations: db
      .prepare("SELECT id, title, file_id, status, mode, created_at FROM creations ORDER BY created_at DESC LIMIT 6")
      .all(),
  });
});
