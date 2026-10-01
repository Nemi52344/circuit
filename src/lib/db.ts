import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'upload',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inspirations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  competitor TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creations (
  id TEXT PRIMARY KEY,
  inspiration_id TEXT,
  product_id TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'gemini',
  file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  creation_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  posted_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  period TEXT NOT NULL DEFAULT '',
  impressions INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  clicks INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  collected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'higgsfield',
  kind TEXT NOT NULL DEFAULT 'image',
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  inspiration_id TEXT,
  product_id TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  creation_id TEXT,
  external_id TEXT NOT NULL DEFAULT '',
  cost TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON render_jobs(status);
CREATE TABLE IF NOT EXISTS pillars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '10:00',
  platforms TEXT NOT NULL DEFAULT '[]',
  pillar_id TEXT,
  topic TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'image',
  stage INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned',
  source TEXT NOT NULL DEFAULT 'manual',
  reason TEXT NOT NULL DEFAULT '',
  research TEXT NOT NULL DEFAULT '{}',
  iterations INTEGER NOT NULL DEFAULT 3,
  product_id TEXT,
  model TEXT NOT NULL DEFAULT 'gpt_image_2_5',
  final_creation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(date);
CREATE TABLE IF NOT EXISTS slot_samples (
  slot_id TEXT NOT NULL,
  inspiration_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slot_id, inspiration_id)
);
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_status ON research_jobs(status);
CREATE TABLE IF NOT EXISTS own_posts (
  id TEXT PRIMARY KEY,
  ig_id TEXT NOT NULL UNIQUE,
  permalink TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL DEFAULT '',
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  reach INTEGER,
  saved INTEGER,
  shares INTEGER,
  file_id TEXT,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS poster_tags (
  id TEXT PRIMARY KEY,
  own_post_id TEXT NOT NULL UNIQUE,
  ig_id TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '{}',
  tagged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  shape TEXT NOT NULL DEFAULT '',
  search INTEGER NOT NULL DEFAULT 1,
  context TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  trigger TEXT NOT NULL DEFAULT 'manual',
  at_time TEXT NOT NULL DEFAULT '09:00',
  weekday INTEGER,
  builtin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  steps TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'brochure',
  tags TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'market',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  dated TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'medium',
  tags TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'live',
  fingerprint TEXT NOT NULL DEFAULT '',
  seen_count INTEGER NOT NULL DEFAULT 1,
  found_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_fp ON knowledge (fingerprint);
CREATE TABLE IF NOT EXISTS roadmap (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'feature',
  requirement TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',
  risk TEXT NOT NULL DEFAULT '',
  acceptance TEXT NOT NULL DEFAULT '',
  effort TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_mail (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'note',
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intel_pdfs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT '',
  items INTEGER NOT NULL DEFAULT 0,
  pdf_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'circuit',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intel_pdfs_date ON intel_pdfs (date);
CREATE TABLE IF NOT EXISTS approvers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  version TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  comment TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_approvals_slot ON approvals(slot_id);
CREATE TABLE IF NOT EXISTS slot_slides (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image_idea TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slides_slot ON slot_slides(slot_id);
CREATE TABLE IF NOT EXISTS slot_content (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT NOT NULL DEFAULT '',
  post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (slot_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_posts_sched ON posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_metrics_post ON metrics(post_id);
/* The business side of the house: the work board, what we hold and owe, and what it costs.

   All of it is typed in by hand — Circuit has no ledger to read from and should not pretend to.
   Money is kept in paise (integers) so no total ever drifts by a rounding error. */

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  owner       TEXT NOT NULL DEFAULT '',
  area        TEXT NOT NULL DEFAULT 'marketing',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'planned',
  progress    INTEGER NOT NULL DEFAULT 0,
  depends_on  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id          TEXT PRIMARY KEY,
  vendor      TEXT NOT NULL,
  number      TEXT NOT NULL DEFAULT '',
  bill_date   TEXT NOT NULL,
  due_date    TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL DEFAULT 0,
  tax         INTEGER NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'other',
  status      TEXT NOT NULL DEFAULT 'unpaid',
  file_id     TEXT,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
  id          TEXT PRIMARY KEY,
  item        TEXT NOT NULL,
  sku         TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'other',
  qty         REAL NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'nos',
  location    TEXT NOT NULL DEFAULT '',
  reorder_at  REAL NOT NULL DEFAULT 0,
  unit_cost   INTEGER NOT NULL DEFAULT 0,
  counted_at  TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '',
  department    TEXT NOT NULL DEFAULT '',
  monthly_cost  INTEGER NOT NULL DEFAULT 0,
  started_on    TEXT NOT NULL DEFAULT '',
  ended_on      TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'payroll',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opex (
  id            TEXT PRIMARY KEY,
  item          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other',
  vendor        TEXT NOT NULL DEFAULT '',
  monthly_cost  INTEGER NOT NULL DEFAULT 0,
  starts_on     TEXT NOT NULL DEFAULT '',
  ends_on       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pnl (
  month       TEXT PRIMARY KEY,
  revenue     INTEGER NOT NULL DEFAULT 0,
  cogs        INTEGER NOT NULL DEFAULT 0,
  other_in    INTEGER NOT NULL DEFAULT 0,
  other_out   INTEGER NOT NULL DEFAULT 0,
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

/* What people say back.

   Comments and replies on the brand's own posts, wherever they came from, with the reply Circuit
   drafted for each one. Nothing here is ever sent on its own: a draft sits until a person reads
   it and presses send, because a reply from the brand account is the brand speaking. */

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  platform    TEXT NOT NULL,
  post_ref    TEXT NOT NULL DEFAULT '',
  post_title  TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL,
  posted_at   TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'unsorted',
  status      TEXT NOT NULL DEFAULT 'new',
  draft       TEXT NOT NULL DEFAULT '',
  why         TEXT NOT NULL DEFAULT '',
  sent_at     TEXT,
  source      TEXT NOT NULL DEFAULT 'pasted',
  external_id TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS comments_external ON comments (platform, external_id) WHERE external_id <> '';

/* The card statement, and what was on it.

   The statement is the only honest record of what the company actually paid: it carries the
   conversion fee that a tool's own receipt never shows, which is why a sheet converting dollars
   at a flat rate drifts below reality every month. So the statement leads — each line on it is a
   charge that happened — and the receipt from the inbox is the supporting paper attached to it. */

CREATE TABLE IF NOT EXISTS statements (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  file_id     TEXT,
  period      TEXT NOT NULL DEFAULT '',
  card        TEXT NOT NULL DEFAULT '',
  total       INTEGER NOT NULL DEFAULT 0,
  lines       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'new',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS charges (
  id            TEXT PRIMARY KEY,
  statement_id  TEXT NOT NULL,
  charged_on    TEXT NOT NULL DEFAULT '',
  merchant      TEXT NOT NULL,
  amount        INTEGER NOT NULL DEFAULT 0,
  foreign_amount TEXT NOT NULL DEFAULT '',
  vendor        TEXT NOT NULL DEFAULT '',
  bill_id       TEXT,
  receipt_file  TEXT,
  status        TEXT NOT NULL DEFAULT 'unmatched',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

`;

declare global {
  // eslint-disable-next-line no-var
  var __circuitDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!global.__circuitDb) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const db = new Database(path.join(DATA_DIR, "circuit.db"));
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    ensureColumn(db, "inspirations", "rights", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "inspirations", "origin", "TEXT NOT NULL DEFAULT ''");
    // drafts, iterations and posts all know which content slot they belong to
    ensureColumn(db, "creations", "slot_id", "TEXT");
    ensureColumn(db, "creations", "round", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "creations", "parent_id", "TEXT");
    ensureColumn(db, "render_jobs", "slot_id", "TEXT");
    ensureColumn(db, "render_jobs", "round", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "render_jobs", "parent_id", "TEXT");
    ensureColumn(db, "render_jobs", "reference_file", "TEXT");
    ensureColumn(db, "posts", "slot_id", "TEXT");
    ensureColumn(db, "pillars", "weight", "INTEGER NOT NULL DEFAULT 20");
    ensureColumn(db, "pillars", "platforms", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(db, "pillars", "examples", "TEXT NOT NULL DEFAULT '[]'");
    // one queue for Claude text work: "research" (stage 2) and "copy" (captions for stage 7)
    ensureColumn(db, "research_jobs", "kind", "TEXT NOT NULL DEFAULT 'research'");
    ensureColumn(db, "render_jobs", "slide_id", "TEXT");
    ensureColumn(db, "slot_slides", "bg_file_id", "TEXT");
    ensureColumn(db, "research_jobs", "payload", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(db, "products", "source_path", "TEXT NOT NULL DEFAULT ''");
    // the library doubles as the brand's own asset store: what a file is, and how to find it
    ensureColumn(db, "files", "tags", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "files", "title", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "files", "brand", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "files", "poster_id", "TEXT");
    global.__circuitDb = db;
  }
  return global.__circuitDb;
}

function ensureColumn(db: Database.Database, table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export type FileRow = { id: string; name: string; mime: string; size: number; path: string; kind: string; created_at: string };

const SAFE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function saveFileBuffer(buf: Buffer, name: string, mime: string, kind = "upload"): FileRow {
  const id = newId();
  const ext = SAFE_EXT[mime] || (name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin");
  const rel = `${id}.${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, rel), buf);
  const row: FileRow = { id, name, mime, size: buf.length, path: rel, kind, created_at: now() };
  getDb()
    .prepare("INSERT INTO files (id, name, mime, size, path, kind, created_at) VALUES (@id, @name, @mime, @size, @path, @kind, @created_at)")
    .run(row);
  return row;
}

export function getFile(id: string): FileRow | undefined {
  return getDb().prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
}

export function readFileBase64(id: string): { mime: string; data: string } | null {
  const f = getFile(id);
  if (!f) return null;
  const buf = fs.readFileSync(path.join(UPLOAD_DIR, f.path));
  return { mime: f.mime, data: buf.toString("base64") };
}

/* Everywhere a file can still be spoken for. A picture is shared more often than it looks:
   the same creation can be a post's image and a slide's background at once. */
const FILE_OWNERS: { table: string; column: string }[] = [
  { table: "creations", column: "file_id" },
  { table: "inspirations", column: "file_id" },
  { table: "products", column: "file_id" },
  { table: "posts", column: "file_id" },
  { table: "slot_slides", column: "file_id" },
  { table: "slot_slides", column: "bg_file_id" },
  { table: "own_posts", column: "file_id" },
  { table: "documents", column: "file_id" },
];

/* Who else is using this picture. Returns the tables that still point at it. */
export function fileOwners(id: string): string[] {
  const db = getDb();
  const out: string[] = [];
  for (const o of FILE_OWNERS) {
    try {
      const row = db.prepare(`SELECT 1 FROM ${o.table} WHERE ${o.column} = ? LIMIT 1`).get(id);
      if (row) out.push(`${o.table}.${o.column}`);
    } catch {
      // a table that doesn't exist in this database yet can't be holding anything
    }
  }
  return out;
}

export type DeleteFileResult = "deleted" | "missing" | "in_use" | "failed";

/* Removing a picture. A file still owned by another record is left alone rather than pulled
   out from under it, and a file already gone from disk is not treated as a failure. */
export function deleteFile(id: string): DeleteFileResult {
  const f = getFile(id);
  if (!f) return "missing";
  if (fileOwners(id).length) return "in_use";
  const full = path.join(UPLOAD_DIR, f.path);
  if (fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch {
      // the row stays so the file is not lost track of, and the caller is told
      return "failed";
    }
  }
  getDb().prepare("DELETE FROM files WHERE id = ?").run(id);
  return "deleted";
}
