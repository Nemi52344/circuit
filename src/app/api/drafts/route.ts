import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

const TYPES = ["blog", "email", "whatsapp", "ad", "caption"];

export const GET = handle(async (req) => {
  const type = new URL(req.url).searchParams.get("type");
  const rows = type
    ? getDb().prepare("SELECT * FROM drafts WHERE type = ? ORDER BY updated_at DESC").all(type)
    : getDb().prepare("SELECT * FROM drafts ORDER BY updated_at DESC").all();
  return ok(rows);
});

export const POST = handle(async (req) => {
  const b = await readJson<{ type: string; title?: string; body?: string; meta?: unknown }>(req);
  if (!TYPES.includes(b.type)) return bad("Unknown draft type");
  const id = newId();
  const t = now();
  getDb()
    .prepare("INSERT INTO drafts (id, type, title, body, meta, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)")
    .run(id, b.type, b.title || "Untitled", b.body || "", JSON.stringify(b.meta || {}), t, t);
  return ok({ id }, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<{ id: string; title?: string; body?: string; meta?: unknown; status?: string }>(req);
  if (!b.id) return bad("id required");
  getDb()
    .prepare(
      "UPDATE drafts SET title = COALESCE(?, title), body = COALESCE(?, body), meta = COALESCE(?, meta), status = COALESCE(?, status), updated_at = ? WHERE id = ?",
    )
    .run(b.title ?? null, b.body ?? null, b.meta === undefined ? null : JSON.stringify(b.meta), b.status ?? null, now(), b.id);
  return ok({ updated: b.id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  getDb().prepare("DELETE FROM drafts WHERE id = ?").run(id);
  return ok({ deleted: id });
});
