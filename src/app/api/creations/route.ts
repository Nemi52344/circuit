import { getDb, newId, now, saveFileBuffer, deleteFile } from "@/lib/db";
import { handle, ok, bad, str, readJson } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const rows = getDb()
    .prepare(
      `SELECT c.*, f.mime, i.title AS inspiration_title, i.competitor, p.name AS product_name, p.color AS product_color,
              (SELECT COUNT(*) FROM posts po WHERE po.creation_id = c.id) AS post_count
       FROM creations c
       LEFT JOIN files f ON f.id = c.file_id
       LEFT JOIN inspirations i ON i.id = c.inspiration_id
       LEFT JOIN products p ON p.id = c.product_id
       ORDER BY c.created_at DESC`,
    )
    .all();
  return ok(rows);
});

// Assisted or manual upload of a finished creative.
export const POST = handle(async (req) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return bad("Choose the finished image");
  const mode = str(form.get("mode"), "assisted");
  const inspiration_id = str(form.get("inspiration_id")) || null;
  const product_id = str(form.get("product_id")) || null;
  const title = str(form.get("title"));
  const prompt = str(form.get("prompt"));
  const model = str(form.get("model"), mode === "assisted" ? "assistant handoff" : "manual upload");
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?)",
  );
  const created = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) return bad(`${f.name} is not an image`);
    const buf = Buffer.from(await f.arrayBuffer());
    const file = saveFileBuffer(buf, f.name, f.type, "generated");
    const id = newId();
    insert.run(id, inspiration_id, product_id, prompt, model, mode, file.id, title || f.name.replace(/\.[^.]+$/, ""), now());
    created.push({ id, file_id: file.id });
  }
  return ok(created, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<{ id: string; status?: string; title?: string }>(req);
  if (!b.id) return bad("id required");
  const allowed = ["generated", "saved", "approved", "rejected"];
  if (b.status && !allowed.includes(b.status)) return bad("Unknown status");
  getDb()
    .prepare("UPDATE creations SET status = COALESCE(?, status), title = COALESCE(?, title) WHERE id = ?")
    .run(b.status ?? null, b.title ?? null, b.id);
  return ok({ updated: b.id });
});

/* Deleting a creation must not take a planned post with it. The post is real work — a caption,
   a time, sometimes a live link — so it is detached and left as a text post rather than being
   left pointing at a picture that no longer exists. The whole detach-and-delete is one
   transaction, so a post can never be half-detached. */
export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const db = getDb();
  const row = db.prepare("SELECT file_id FROM creations WHERE id = ?").get(id) as { file_id: string } | undefined;
  if (!row) return ok({ deleted: id, detached: 0, file: "missing" });

  const detach = db.transaction((creationId: string, fileId: string | null) => {
    const touched = db.prepare("SELECT COUNT(*) n FROM posts WHERE creation_id = ?").get(creationId) as { n: number };
    // the post keeps its caption, its time and its live link; only the picture goes
    db.prepare("UPDATE posts SET creation_id = NULL, updated_at = ? WHERE creation_id = ?").run(now(), creationId);
    if (fileId) db.prepare("UPDATE posts SET file_id = NULL, updated_at = ? WHERE file_id = ?").run(now(), fileId);
    db.prepare("UPDATE slots SET final_creation_id = NULL, updated_at = ? WHERE final_creation_id = ?").run(now(), creationId);
    db.prepare("DELETE FROM creations WHERE id = ?").run(creationId);
    return touched.n;
  });
  const detached = detach(id, row.file_id || null);

  // only now can the picture go, and only if nothing else still uses it
  const file = row.file_id ? deleteFile(row.file_id) : "missing";
  return ok({ deleted: id, detached, file });
});
