import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

const STATUSES = ["draft", "approved", "scheduled", "posted", "failed"];

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  const base = `SELECT po.*, c.title AS creation_title, COALESCE(po.file_id, c.file_id) AS image_file_id,
                (SELECT COUNT(*) FROM metrics m WHERE m.post_id = po.id) AS metric_count
                FROM posts po LEFT JOIN creations c ON c.id = po.creation_id`;
  const rows =
    from && to
      ? getDb().prepare(`${base} WHERE po.scheduled_at >= ? AND po.scheduled_at < ? ORDER BY po.scheduled_at`).all(from, to)
      : getDb().prepare(`${base} ORDER BY po.scheduled_at`).all();
  return ok(rows);
});

export const POST = handle(async (req) => {
  const b = await readJson<Record<string, string>>(req);
  if (!b.platform || !b.scheduled_at) return bad("platform and scheduled_at are required");
  /* A post added by hand can arrive at any stage — including one that already went out, being
     written down after the fact — so status and the live URL are accepted on the way in too. */
  const status = b.status || "draft";
  if (!STATUSES.includes(status)) return bad("Unknown status");
  if (status === "posted" && !(b.posted_url || "").trim()) return bad("Posted needs the live post URL as evidence");
  if (b.file_id && !getDb().prepare("SELECT 1 FROM files WHERE id = ?").get(b.file_id)) return bad("That picture no longer exists");
  const id = newId();
  const t = now();
  getDb()
    .prepare(
      "INSERT INTO posts (id, platform, caption, file_id, creation_id, scheduled_at, status, posted_url, notes, slot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, b.platform, b.caption || "", b.file_id || null, b.creation_id || null, b.scheduled_at, status, (b.posted_url || "").trim(), b.notes || "", b.slot_id || null, t, t);
  return ok({ id }, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<Record<string, string>>(req);
  if (!b.id) return bad("id required");
  if (b.status && !STATUSES.includes(b.status)) return bad("Unknown status");
  if (b.status === "posted" && !(b.posted_url || "").trim()) {
    const existing = getDb().prepare("SELECT posted_url FROM posts WHERE id = ?").get(b.id) as { posted_url: string } | undefined;
    if (!existing?.posted_url) return bad("Posted needs the live post URL as evidence");
  }
  /* Only the fields actually sent are changed, so a picture can be taken off a post by sending
     null — which COALESCE could never express, because it treated "clear this" and "leave it
     alone" as the same thing. */
  const FIELDS = ["platform", "caption", "file_id", "creation_id", "scheduled_at", "status", "posted_url", "notes", "slot_id"] as const;
  const sent = FIELDS.filter((f) => f in b);
  if (!sent.length) return ok({ updated: b.id, changed: 0 });
  // a reference must point at something that exists, or be cleared outright
  if (b.creation_id && !getDb().prepare("SELECT 1 FROM creations WHERE id = ?").get(b.creation_id)) return bad("That creation no longer exists");
  if (b.file_id && !getDb().prepare("SELECT 1 FROM files WHERE id = ?").get(b.file_id)) return bad("That picture no longer exists");

  getDb()
    .prepare(`UPDATE posts SET ${sent.map((f) => `${f} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...sent.map((f) => (b[f] === "" && (f === "file_id" || f === "creation_id") ? null : b[f] ?? null)), now(), b.id);
  return ok({ updated: b.id, changed: sent.length });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  getDb().prepare("DELETE FROM metrics WHERE post_id = ?").run(id);
  getDb().prepare("DELETE FROM posts WHERE id = ?").run(id);
  return ok({ deleted: id });
});
