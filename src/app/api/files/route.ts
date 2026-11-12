import { getDb, saveFileBuffer, findByHash, hashBuffer } from "@/lib/db";
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
  /* One kind, or several separated by commas: the Collateral shows the raw shoot and the
     product photographs together. */
  const kinds = (kind || "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 8);
  if (kinds.length) { where.push(`kind IN (${kinds.map(() => "?").join(", ")})`); args.push(...kinds); }
  if (brand === "1") where.push("brand = 1");
  const sql = `SELECT * FROM files${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
  return ok(getDb().prepare(sql).all(...args));
});

export const POST = handle(async (req) => {
  const form = await req.formData();
  const kind = str(form.get("kind"), "upload");
  const tags = str(form.get("tags"), "");
  const brand = str(form.get("brand"), "") === "1" ? 1 : 0;
  const rights = str(form.get("rights"), "").slice(0, 300);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return bad("No files received");
  const db = getDb();
  const saved = [];
  const already: string[] = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    /* If these exact bytes are already here, hand back the file we have and say so. Two copies
       of one photograph is how a library stops being searchable. */
    const seen = findByHash(hashBuffer(buf));
    if (seen) { already.push(f.name); saved.push({ ...seen, tags: seen.tags || "", brand: seen.brand ?? 0, title: seen.title || "" }); continue; }
    const row = saveFileBuffer(buf, f.name, f.type || "application/octet-stream", kind);
    if (tags || brand || rights) {
      /* The name a camera gives a file is not a title, so the only sensible default is the name
         with its extension taken off — better than nothing, and easy to correct. */
      db.prepare("UPDATE files SET tags = ?, brand = ?, title = ?, rights = ? WHERE id = ?")
        .run(tags, brand, f.name.replace(/\.[^.]+$/, ""), rights, row.id);
    }
    saved.push({ ...row, tags, brand, title: "" });
  }
  /* The caller is told what was already here, so it can say "3 saved, 1 already in the
     library" rather than pretending four new files arrived. */
  return ok({ files: saved, saved: saved.length - already.length, already }, 201);
});

/* Naming and tagging afterwards, which is when it usually happens. */
export const PATCH = handle(async (req) => {
  const b = await readJson<{ id?: string; title?: string; tags?: string; brand?: boolean; kind?: string; rights?: string }>(req);
  if (!b.id) return bad("id required");
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.title !== undefined) { sets.push("title = ?"); vals.push(b.title.slice(0, 200)); }
  if (b.tags !== undefined) { sets.push("tags = ?"); vals.push(b.tags.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean).join(", ").slice(0, 300)); }
  if (b.brand !== undefined) { sets.push("brand = ?"); vals.push(b.brand ? 1 : 0); }
  if (b.kind !== undefined) { sets.push("kind = ?"); vals.push(b.kind); }
  /* What this picture may be used for. A competitor's screenshot and our own photography look
     identical in a grid six months later; only this line tells them apart. */
  if (b.rights !== undefined) { sets.push("rights = ?"); vals.push(b.rights.slice(0, 300)); }
  if (!sets.length) return bad("Nothing to change");
  db.prepare(`UPDATE files SET ${sets.join(", ")} WHERE id = ?`).run(...vals, b.id);
  return ok(db.prepare("SELECT * FROM files WHERE id = ?").get(b.id));
});
