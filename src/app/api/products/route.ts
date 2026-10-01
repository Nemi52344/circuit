import { getDb, newId, now, saveFileBuffer, deleteFile } from "@/lib/db";
import { handle, ok, bad, str, readJson } from "@/lib/http";
import { syncProductFolder } from "@/lib/productfolder";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  // photos dropped into the product root folder show up without an import step
  let folder: ReturnType<typeof syncProductFolder> | null = null;
  try { folder = syncProductFolder(); } catch { folder = null; }
  const rows = getDb()
    .prepare("SELECT p.*, f.mime, f.name AS file_name FROM products p LEFT JOIN files f ON f.id = p.file_id ORDER BY p.created_at DESC")
    .all();
  if (new URL(req.url).searchParams.get("folder")) return ok({ products: rows, folder });
  return ok(rows);
});

export const POST = handle(async (req) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return bad("Choose at least one product photo");
  const baseName = str(form.get("name"));
  const color = str(form.get("color"));
  const tags = str(form.get("tags"));
  const db = getDb();
  const insert = db.prepare("INSERT INTO products (id, name, color, tags, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const created = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) return bad(`${f.name} is not an image`);
    const buf = Buffer.from(await f.arrayBuffer());
    const file = saveFileBuffer(buf, f.name, f.type, "product");
    const name = baseName || f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    const id = newId();
    insert.run(id, name, color, tags, file.id, now());
    created.push({ id, name, color, tags, file_id: file.id });
  }
  return ok(created, 201);
});

export const PATCH = handle(async (req) => {
  const body = await readJson<{ id: string; name?: string; color?: string; tags?: string }>(req);
  if (!body.id) return bad("id required");
  getDb()
    .prepare("UPDATE products SET name = COALESCE(?, name), color = COALESCE(?, color), tags = COALESCE(?, tags) WHERE id = ?")
    .run(body.name ?? null, body.color ?? null, body.tags ?? null, body.id);
  return ok({ updated: body.id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const row = getDb().prepare("SELECT file_id FROM products WHERE id = ?").get(id) as { file_id: string } | undefined;
  getDb().prepare("DELETE FROM products WHERE id = ?").run(id);
  if (row?.file_id) deleteFile(row.file_id);
  return ok({ deleted: id });
});
