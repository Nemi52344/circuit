import { getDb, saveFileBuffer } from "@/lib/db";
import { handle, ok, bad, str, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 600;

/* The brand's own store of pictures and video.

   Circuit already kept every file it touched; what it could not do was tell you which of them
   were the brand's — the shot of the bike you actually use, the reel that did well — as opposed
   to the hundreds of drafts and scraped references it also holds. A title, a few words of tag
   and a "this is ours" mark are enough to make the difference findable. */

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind");
  const brand = u.searchParams.get("brand");
  const where: string[] = [];
  const args: unknown[] = [];
  if (kind) { where.push("kind = ?"); args.push(kind); }
  if (brand === "1") where.push("brand = 1");
  const sql = `SELECT * FROM files${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
  return ok(getDb().prepare(sql).all(...args));
});

export const POST = handle(async (req) => {
  const form = await req.formData();
  const kind = str(form.get("kind"), "upload");
  const tags = str(form.get("tags"), "");
  const brand = str(form.get("brand"), "") === "1" ? 1 : 0;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return bad("No files received");
  const db = getDb();
  const saved = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const row = saveFileBuffer(buf, f.name, f.type || "application/octet-stream", kind);
    if (tags || brand) {
      /* The name a camera gives a file is not a title, so the only sensible default is the name
         with its extension taken off — better than nothing, and easy to correct. */
      db.prepare("UPDATE files SET tags = ?, brand = ?, title = ? WHERE id = ?")
        .run(tags, brand, f.name.replace(/\.[^.]+$/, ""), row.id);
    }
    saved.push({ ...row, tags, brand, title: "" });
  }
  return ok(saved, 201);
});

/* Naming and tagging afterwards, which is when it usually happens. */
export const PATCH = handle(async (req) => {
  const b = await readJson<{ id?: string; title?: string; tags?: string; brand?: boolean; kind?: string }>(req);
  if (!b.id) return bad("id required");
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.title !== undefined) { sets.push("title = ?"); vals.push(b.title.slice(0, 200)); }
  if (b.tags !== undefined) { sets.push("tags = ?"); vals.push(b.tags.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean).join(", ").slice(0, 300)); }
  if (b.brand !== undefined) { sets.push("brand = ?"); vals.push(b.brand ? 1 : 0); }
  if (b.kind !== undefined) { sets.push("kind = ?"); vals.push(b.kind); }
  if (!sets.length) return bad("Nothing to change");
  db.prepare(`UPDATE files SET ${sets.join(", ")} WHERE id = ?`).run(...vals, b.id);
  return ok(db.prepare("SELECT * FROM files WHERE id = ?").get(b.id));
});
