import { getDb, newId, now, saveFileBuffer, deleteFile } from "@/lib/db";
import { handle, ok, bad, str, readJson } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const rows = getDb()
    .prepare("SELECT i.*, f.mime FROM inspirations i LEFT JOIN files f ON f.id = i.file_id ORDER BY i.created_at DESC")
    .all();
  return ok(rows);
});

export const POST = handle(async (req) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const meta = {
    title: str(form.get("title")),
    competitor: str(form.get("competitor")),
    platform: str(form.get("platform")),
    format: str(form.get("format")),
    source_url: str(form.get("source_url")),
    notes: str(form.get("notes")),
    rights: str(form.get("rights")),
  };
  if (!files.length && !meta.source_url) return bad("Add an image or a source link");
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO inspirations (id, title, competitor, platform, format, source_url, notes, file_id, rights, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const created = [];
  if (!files.length) {
    const id = newId();
    insert.run(id, meta.title, meta.competitor, meta.platform, meta.format, meta.source_url, meta.notes, null, meta.rights, meta.source_url, now());
    created.push({ id, ...meta, file_id: null });
  }
  for (const f of files) {
    if (!f.type.startsWith("image/")) return bad(`${f.name} is not an image`);
    const buf = Buffer.from(await f.arrayBuffer());
    const file = saveFileBuffer(buf, f.name, f.type, "inspiration");
    const id = newId();
    const title = meta.title || f.name.replace(/\.[^.]+$/, "");
    insert.run(id, title, meta.competitor, meta.platform, meta.format, meta.source_url, meta.notes, file.id, meta.rights, "", now());
    created.push({ id, ...meta, title, file_id: file.id });
  }
  return ok(created, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<Record<string, string>>(req);
  if (!b.id) return bad("id required");
  getDb()
    .prepare(
      "UPDATE inspirations SET title = COALESCE(?, title), competitor = COALESCE(?, competitor), platform = COALESCE(?, platform), format = COALESCE(?, format), source_url = COALESCE(?, source_url), notes = COALESCE(?, notes), rights = COALESCE(?, rights) WHERE id = ?",
    )
    .run(b.title ?? null, b.competitor ?? null, b.platform ?? null, b.format ?? null, b.source_url ?? null, b.notes ?? null, b.rights ?? null, b.id);
  return ok({ updated: b.id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const row = getDb().prepare("SELECT file_id FROM inspirations WHERE id = ?").get(id) as { file_id: string | null } | undefined;
  getDb().prepare("DELETE FROM inspirations WHERE id = ?").run(id);
  if (row?.file_id) deleteFile(row.file_id);
  return ok({ deleted: id });
});
