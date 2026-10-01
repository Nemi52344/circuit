import { getDb, newId, now, saveFileBuffer, deleteFile } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

/* Brochures, spec sheets, price lists, anything the agents should be able to quote from.
   The text is kept beside the file so an agent can read it without opening a PDF. */
export const GET = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return ok(getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) || {});
  return ok(getDb().prepare("SELECT id, title, kind, tags, notes, file_id, length(text) text_length, created_at FROM documents ORDER BY created_at DESC").all());
});

export const POST = handle(async (req) => {
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return bad("Choose a file");
    const kind = String(form.get("kind") || "brochure");
    const tags = String(form.get("tags") || "");
    const created: { id: string; title: string }[] = [];
    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer());
      const saved = saveFileBuffer(buf, f.name, f.type || "application/octet-stream", "document");
      // plain text and markdown can be read straight away; a PDF keeps its file and waits for text
      const text = /^text\/|json|markdown/.test(f.type) ? buf.toString("utf8").slice(0, 200000) : "";
      const id = newId();
      getDb().prepare("INSERT INTO documents (id, title, kind, tags, notes, text, file_id, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)")
        .run(id, f.name.replace(/\.[^.]+$/, ""), kind, tags, text, saved.id, now(), now());
      created.push({ id, title: f.name });
    }
    return ok({ created });
  }
  const b = await readJson<{ id?: string; title?: string; kind?: string; tags?: string; notes?: string; text?: string }>(req);
  if (b.id) {
    getDb().prepare("UPDATE documents SET title = COALESCE(?, title), kind = COALESCE(?, kind), tags = COALESCE(?, tags), notes = COALESCE(?, notes), text = COALESCE(?, text), updated_at = ? WHERE id = ?")
      .run(b.title ?? null, b.kind ?? null, b.tags ?? null, b.notes ?? null, b.text ?? null, now(), b.id);
    return ok({ updated: b.id });
  }
  if (!b.title?.trim()) return bad("Give it a title");
  const id = newId();
  getDb().prepare("INSERT INTO documents (id, title, kind, tags, notes, text, file_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)")
    .run(id, b.title.trim(), b.kind || "note", b.tags || "", b.notes || "", b.text || "", now(), now());
  return ok({ id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const row = getDb().prepare("SELECT file_id FROM documents WHERE id = ?").get(id) as { file_id: string | null } | undefined;
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
  if (row?.file_id) deleteFile(row.file_id);
  return ok({ deleted: id });
});
