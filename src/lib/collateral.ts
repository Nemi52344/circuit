import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, getSetting, setSetting, findByHash, uploadDir, putFileFromPath, newId, now, type FileRow } from "@/lib/db";
import { userError } from "@/lib/http";
import { findTool } from "@/lib/toolpath";

/* Raw collateral — the photographs and video from our own shoots — brought in from wherever it
   already lives, and stored in the database like every other file: a folder dropped on the Library, a zip downloaded from SharePoint, or a folder
   on this Mac that Circuit watches (the OneDrive folder, once OneDrive syncs it here).

   Every file comes in as ours and free to publish, tagged with the folders it sat in, so
   "Master / Challenger / Studio shoot" is findable as challenger, studio shoot. Nothing is ever
   imported twice: the same bytes are recognised however they arrive, and a watched folder
   remembers each file by path, size and date so a 2 GB video is not re-read every ten minutes.
   iPhone photos (HEIC) are turned into JPEG on the way in, because browsers cannot show HEIC. */

const run = promisify(execFile);
const OURS = "Ours, free to publish";
const MEDIA: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heic",
  tif: "image/tiff", tiff: "image/tiff", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4",
  /* Brochures and spec sheets in the shoot folder go to the Library's Brochures, not the photos. */
  pdf: "application/pdf",
};
const ext = (name: string) => (name.split(".").pop() || "").toLowerCase();
export const isMedia = (name: string) => Boolean(MEDIA[ext(name)]) && !path.basename(name).startsWith(".");

/* "Master/Challenger/Studio shoot/IMG_0042.JPG" → tags "challenger, studio shoot". The top
   folder is the container, not a description, so it is left out when there is more than one. */
export function tagsFromPath(rel: string, extra = ""): string {
  const parts = rel.split(/[\\/]/).slice(0, -1).map((p) => p.trim()).filter((p) => p && !p.startsWith("."));
  const keep = parts.length > 1 ? parts.slice(1) : parts;
  return [...new Set([...keep, ...extra.split(",")].map((t) => t.trim().toLowerCase().replace(/[_-]+/g, " ")).filter(Boolean))].join(", ").slice(0, 300);
}

async function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

/* One file from disk into the library, copied rather than read into memory — a video from a
   shoot can be bigger than this process should hold. Returns the row, and whether it was new. */
export async function importFile(src: string, rel: string, opts: { tags?: string } = {}): Promise<{ row: FileRow; added: boolean }> {
  let file = src;
  let name = path.basename(rel);
  let mime = MEDIA[ext(name)];
  if (!mime) throw userError(`${name} is not a photo, a video or a PDF`);
  if (mime === "application/pdf") return importBrochure(src, rel, opts);
  let tmp = "";
  if (mime === "image/heic" || mime === "image/tiff") {
    tmp = path.join(os.tmpdir(), `circuit-convert-${newId()}.jpg`);
    await run("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", src, "--out", tmp], { timeout: 120000 });
    file = tmp; name = name.replace(/\.[^.]+$/, ".jpg"); mime = "image/jpeg";
  }
  try {
    const sha = await sha256(file);
    const had = findByHash(sha);
    if (had) {
      /* Already here as a plain upload: it was our own shot all along, so it moves into the
         collateral. Anything else Circuit uses it for (a product photo, a reference) stays. */
      if (had.kind === "upload") {
        getDb().prepare("UPDATE files SET kind = 'raw', brand = 1, rights = COALESCE(NULLIF(rights, ''), ?), tags = COALESCE(NULLIF(tags, ''), ?) WHERE id = ?").run(OURS, tagsFromPath(rel, opts.tags || ""), had.id);
      }
      return { row: had, added: false };
    }
    const id = newId();
    const rel2 = `${id}.${mime === "video/quicktime" ? "mov" : ext(name) === "jpeg" ? "jpg" : ext(name)}`;
    fs.mkdirSync(uploadDir(), { recursive: true });
    fs.copyFileSync(file, path.join(uploadDir(), rel2));
    const size = fs.statSync(file).size;
    const db = getDb();
    db.prepare(`INSERT INTO files (id, name, mime, size, path, kind, created_at, sha256, tags, title, brand, rights)
                VALUES (?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, 1, ?)`)
      .run(id, name, mime, size, rel2, now(), sha, tagsFromPath(rel, opts.tags || ""), name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), OURS);
    /* The bytes go into the database, read a chunk at a time; the copy above is only the cache. */
    putFileFromPath(id, file, db);
    return { row: db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow, added: true };
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

export type ImportResult = { added: number; already: number; skipped: number; errors: string[] };

/* Everything under a folder. `remember` is for a watched folder: files already taken, unchanged
   since, are not opened again. */
export async function importFolder(root: string, opts: { tags?: string; remember?: boolean; limit?: number } = {}): Promise<ImportResult> {
  const out: ImportResult = { added: 0, already: 0, skipped: 0, errors: [] };
  const db = getDb();
  const seen = db.prepare("SELECT size, mtime FROM collateral_seen WHERE path = ?");
  const mark = db.prepare(`INSERT INTO collateral_seen (path, size, mtime, file_id, seen_at) VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, file_id = excluded.file_id, seen_at = excluded.seen_at`);
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || e.name === "__MACOSX") return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.isFile() ? [full] : [];
  });
  const base = path.dirname(root);
  for (const full of walk(root)) {
    if (opts.limit && out.added >= opts.limit) break;
    const rel = path.relative(base, full);
    if (!isMedia(full)) { out.skipped++; continue; }
    const st = fs.statSync(full);
    if (opts.remember) {
      const was = seen.get(full) as { size: number; mtime: number } | undefined;
      if (was && was.size === st.size && was.mtime === st.mtimeMs) continue;
    }
    try {
      const r = await importFile(full, rel, { tags: opts.tags });
      if (r.added) out.added++; else out.already++;
      if (opts.remember) mark.run(full, st.size, st.mtimeMs, r.row.id, now());
    } catch (e) { out.errors.push(`${path.basename(full)}: ${(e as Error).message}`); }
  }
  return out;
}

/* A zip from SharePoint or OneDrive ("Download" on a folder gives one): unpacked with macOS's own
   ditto into a scratch folder, imported, and the scratch folder removed. */
export async function importZip(zipPath: string, tags = ""): Promise<ImportResult> {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-zip-"));
  try {
    await run("/usr/bin/ditto", ["-x", "-k", zipPath, dest], { timeout: 30 * 60 * 1000 });
    const tops = fs.readdirSync(dest).filter((n) => !n.startsWith(".") && n !== "__MACOSX");
    const root = tops.length === 1 && fs.statSync(path.join(dest, tops[0])).isDirectory() ? path.join(dest, tops[0]) : dest;
    return await importFolder(root, { tags });
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

/* ---- the watched folder ---- */

const EVERY_MS = 10 * 60 * 1000;
export type Watch = { folder: string; exists: boolean; last: { at: string; added: number; already: number; errors: string[]; more?: boolean } | null };

export function watchSettings(): Watch {
  const folder = getSetting("collateral_folder") || "";
  let last = null;
  try { last = JSON.parse(getSetting("collateral_last") || "null"); } catch { /* none */ }
  return { folder, exists: Boolean(folder && fs.existsSync(folder)), last };
}

export function setWatchFolder(folder: string): Watch {
  const f = folder.trim().replace(/^~(?=\/)/, os.homedir());
  if (f && (!path.isAbsolute(f) || !fs.existsSync(f) || !fs.statSync(f).isDirectory())) throw userError("That folder isn't on this Mac — paste its full path, e.g. /Users/you/Library/CloudStorage/OneDrive-…/Gowtham/Master");
  setSetting("collateral_folder", f);
  return watchSettings();
}

export const watchDue = () => {
  const w = watchSettings();
  /* Straight back if the last pass stopped at its limit with more to bring in. */
  return w.exists && (!w.last || Boolean(w.last.more) || Date.now() - new Date(w.last.at).getTime() > EVERY_MS);
};

let scanning = false;
export async function scanWatchFolder(): Promise<ImportResult | null> {
  const w = watchSettings();
  if (!w.exists || scanning) return null;
  scanning = true;
  try {
    /* A first look at a big folder is done in parts — fifty files a pass — so the worker's other
       rounds are not held up for an hour while a whole archive is copied in. */
    const r = await importFolder(w.folder, { remember: true, limit: 50 });
    setSetting("collateral_last", JSON.stringify({ at: now(), added: r.added, already: r.already, errors: r.errors.slice(0, 5), more: r.added >= 50 }));
    return r;
  } finally { scanning = false; }
}

/* A PDF from the shoot folder becomes a brochure: the file kept, its words read out with
   pdftotext so it can be searched (and quoted from when ChatGPT writes copy), titled from its
   file name and tagged with its folders. The same PDF twice is still one brochure. */
async function importBrochure(src: string, rel: string, opts: { tags?: string }): Promise<{ row: FileRow; added: boolean }> {
  const sha = await sha256(src);
  const had = findByHash(sha);
  if (had) return { row: had, added: false };
  const id = newId();
  const stored = `${id}.pdf`;
  fs.mkdirSync(uploadDir(), { recursive: true });
  fs.copyFileSync(src, path.join(uploadDir(), stored));
  const name = path.basename(rel);
  const title = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  let text = "";
  const tool = findTool("pdftotext");
  if (tool) {
    try { text = (await run(tool, ["-layout", "-enc", "UTF-8", src, "-"], { timeout: 120000, maxBuffer: 20_000_000 })).stdout.slice(0, 200000); } catch { /* a scanned PDF has no text; the file still counts */ }
  }
  const db = getDb();
  db.prepare(`INSERT INTO files (id, name, mime, size, path, kind, created_at, sha256, tags, title, brand, rights)
              VALUES (?, ?, 'application/pdf', ?, ?, 'document', ?, ?, ?, ?, 1, ?)`)
    .run(id, name, fs.statSync(src).size, stored, now(), sha, tagsFromPath(rel, opts.tags || ""), title, OURS);
  putFileFromPath(id, src, db);
  db.prepare("INSERT INTO documents (id, title, kind, tags, notes, text, file_id, created_at, updated_at) VALUES (?, ?, 'brochure', ?, ?, ?, ?, ?, ?)")
    .run(newId(), title, tagsFromPath(rel, opts.tags || ""), `From ${rel}`, text, id, now(), now());
  return { row: db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow, added: true };
}
