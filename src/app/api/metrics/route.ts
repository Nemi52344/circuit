import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  const post_id = new URL(req.url).searchParams.get("post_id");
  const rows = post_id
    ? getDb().prepare("SELECT * FROM metrics WHERE post_id = ? ORDER BY collected_at DESC").all(post_id)
    : getDb()
        .prepare(
          `SELECT m.*, po.platform, po.caption, po.scheduled_at, po.posted_url, po.status AS post_status
           FROM metrics m JOIN posts po ON po.id = m.post_id ORDER BY m.collected_at DESC`,
        )
        .all();
  return ok(rows);
});

const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const POST = handle(async (req) => {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b.post_id) return bad("post_id required");
  const id = newId();
  getDb()
    .prepare(
      "INSERT INTO metrics (id, post_id, source, period, impressions, reach, likes, comments, shares, clicks, notes, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      String(b.post_id),
      String(b.source || "manual"),
      String(b.period || ""),
      num(b.impressions),
      num(b.reach),
      num(b.likes),
      num(b.comments),
      num(b.shares),
      num(b.clicks),
      String(b.notes || ""),
      now(),
    );
  return ok({ id }, 201);
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  getDb().prepare("DELETE FROM metrics WHERE id = ?").run(id);
  return ok({ deleted: id });
});
