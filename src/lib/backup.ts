import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, UPLOAD_DIR, getDb, getSetting, setSetting, now } from "@/lib/db";

/* A copy of everything, made by the app itself once a day. The database is copied properly
   (sqlite's own backup, safe while the app is writing); the uploaded pictures are hard-linked
   into the backup folder, which costs no disk space but survives a file being deleted by hand.
   Seven days are kept. This protects against mistakes, not against the disk dying: for that,
   the whole data folder needs to go somewhere else. */

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP = 7;

export type BackupRun = { at: string; file: string; db_bytes: number; pictures: number; seconds: number };

export function lastBackup(): BackupRun | null {
  try { return JSON.parse(getSetting("last_backup") || "null"); } catch { return null; }
}

export function backupDue(hours = 20) {
  const last = lastBackup();
  return !last || Date.now() - new Date(last.at).getTime() > hours * 3600000;
}

/* Hard-links every upload into backups/uploads. Same bytes on disk, a second name for them. */
function mirrorUploads() {
  const dest = path.join(BACKUP_DIR, "uploads");
  fs.mkdirSync(dest, { recursive: true });
  let linked = 0;
  for (const name of fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []) {
    const from = path.join(UPLOAD_DIR, name);
    const to = path.join(dest, name);
    if (fs.existsSync(to)) continue;
    try { fs.linkSync(from, to); linked++; } catch { try { fs.copyFileSync(from, to); linked++; } catch { /* skip unreadable */ } }
  }
  return linked;
}

function prune() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^circuit-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP)) {
    for (const suffix of ["", "-shm", "-wal"]) {
      try { fs.rmSync(path.join(BACKUP_DIR, old + suffix), { force: true }); } catch { /* already gone */ }
    }
  }
}

export async function runBackup(): Promise<BackupRun> {
  const started = Date.now();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const file = path.join(BACKUP_DIR, `circuit-${stamp}.db`);
  await getDb().backup(file);
  const pictures = mirrorUploads();
  prune();
  const run: BackupRun = {
    at: now(),
    file,
    db_bytes: fs.statSync(file).size,
    pictures,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  setSetting("last_backup", JSON.stringify(run));
  return run;
}

export function backupList() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ name: f, bytes: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtime.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
