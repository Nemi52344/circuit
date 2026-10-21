import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "@/lib/migrate";

export const DATA_DIR = path.join(process.cwd(), "data");

/* ---- more than one brand ----

   The agency runs BNC, iDelivery and BOOMA, and the requirement is that every table is scoped
   by brand. There are two ways to do that and only one of them is safe here.

   Adding a brand_id column to twenty-six tables would mean auditing all 481 prepared
   statements in this codebase and getting every one right. One missed WHERE and BOOMA's
   calendar shows BNC's posts — silently, with no error, in a way nobody notices until a post
   goes out under the wrong name. The failure is invisible and the blast radius is the whole
   point of keeping the brands apart.

   So instead: one database per brand. Scoping stops being something every query has to
   remember and becomes a property of which file is open. A brand cannot see another's rows
   because they are not in the file. Nothing is scoped by convention; it is scoped by physics.

   What stays shared, in accounts.db: who can sign in, their sessions, and the list of brands
   itself. Signing in is not per-brand — the same person runs all three.

   BNC keeps data/circuit.db and data/uploads exactly where they are, so switching this on
   moves none of the existing work. New brands get data/brands/<slug>/. */

export const ACCOUNTS_DB = path.join(DATA_DIR, "accounts.db");

export type Brand = { id: string; slug: string; name: string; dir: string; active: number; created_at: string };

/* The brand that was here before brands existed. Its dir is empty, meaning data/ itself. */
export const DEFAULT_BRAND_SLUG = "bnc";

export const brandDataDir = (slug: string, dir: string): string =>
  dir ? path.join(DATA_DIR, dir) : DATA_DIR;

/* Where the active brand's pictures live. A function rather than a constant, because it now
   depends on which brand is in front. */
export const uploadDir = (): string => { const b = currentBrand(); return path.join(brandDataDir(b.slug, b.dir), "uploads"); };


const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'marketing',
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS post_media (
  post_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, position);
CREATE TABLE IF NOT EXISTS signoffs (
  post_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL,
  by_user TEXT NOT NULL,
  by_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  caption_hash TEXT NOT NULL,
  decided_at TEXT NOT NULL
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
  var __circuitDbs: Map<string, Database.Database> | undefined;
  // eslint-disable-next-line no-var
  var __circuitAccounts: Database.Database | undefined;
}

/* ---- the shared database: who signs in, and which brands exist ---- */

const ACCOUNTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'marketing', pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  /* Relative to data/. Empty means data/ itself, which is where BNC already is. */
  dir TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function getAccountsDb(): Database.Database {
  if (!global.__circuitAccounts) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(ACCOUNTS_DB);
    db.pragma("journal_mode = WAL");
    db.exec(ACCOUNTS_SCHEMA);

    /* First run after the split: the accounts were living in the one database Circuit used to
       have. They are copied, not moved — the originals stay put, harmless, so a rollback to
       the previous version still finds its users where it left them. */
    const haveUsers = (db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n;
    const legacy = path.join(DATA_DIR, "circuit.db");
    if (!haveUsers && fs.existsSync(legacy)) {
      const old = new Database(legacy, { readonly: true });
      try {
        const rows = old.prepare("SELECT * FROM users").all() as Record<string, unknown>[];
        const ins = db.prepare(`INSERT OR IGNORE INTO users (id,name,email,role,pass_salt,pass_hash,active,created_at)
                                VALUES (@id,@name,@email,@role,@pass_salt,@pass_hash,@active,@created_at)`);
        db.transaction(() => { for (const r of rows) ins.run(r); })();
        const ses = old.prepare("SELECT * FROM sessions").all() as Record<string, unknown>[];
        const insS = db.prepare("INSERT OR IGNORE INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (@token_hash,@user_id,@created_at,@expires_at)");
        db.transaction(() => { for (const r of ses) insS.run(r); })();
        if (rows.length) console.log(`[db] brought ${rows.length} account(s) and ${ses.length} session(s) into accounts.db`);
      } catch { /* an older file without those tables is simply nothing to bring over */ }
      finally { old.close(); }
    }

    /* The two roles Circuit shipped with, said in the five-role vocabulary.

       An admin signed things off and handed out accounts, which is the owner; marketing made
       the work, which is the creator. Done once, in place: the words changed, nobody's
       permissions did. Code also reads the old values through asRole(), so a database that
       somehow misses this still behaves. */
    const renamed = db.prepare("UPDATE users SET role = 'owner' WHERE role = 'admin'").run().changes
      + db.prepare("UPDATE users SET role = 'creator' WHERE role = 'marketing'").run().changes;
    if (renamed) console.log(`[db] ${renamed} account(s) moved to the five-role names`);

    /* The brand that was always here. Its dir is empty, so its database and pictures stay
       exactly where they have always been. */
    const haveBrands = (db.prepare("SELECT COUNT(*) n FROM brands").get() as { n: number }).n;
    if (!haveBrands) {
      db.prepare("INSERT INTO brands (id, slug, name, dir, active, created_at) VALUES (?, ?, ?, '', 1, ?)")
        .run(randomUUID(), DEFAULT_BRAND_SLUG, "BNC Motors", new Date().toISOString());
    }
    global.__circuitAccounts = db;
  }
  return global.__circuitAccounts;
}

export function accountSetting(key: string): string | null {
  const r = getAccountsDb().prepare("SELECT value FROM account_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r ? r.value : null;
}
export function setAccountSetting(key: string, value: string) {
  getAccountsDb().prepare("INSERT INTO account_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export const listBrands = (): Brand[] =>
  getAccountsDb().prepare("SELECT * FROM brands WHERE active = 1 ORDER BY created_at").all() as Brand[];

/* Which brand is in front. One owner at one Mac, so this is a single stored choice rather
   than something carried per browser tab — and the background worker needs to read the same
   answer, which a cookie could not give it. */
export function activeBrand(): Brand {
  const all = listBrands();
  const want = accountSetting("active_brand");
  return all.find((b) => b.slug === want) || all[0];
}

export function setActiveBrand(slug: string): Brand {
  const b = listBrands().find((x) => x.slug === slug);
  if (!b) throw new Error("No such brand");
  setAccountSetting("active_brand", slug);
  return b;
}

export function createBrand(name: string): Brand {
  const clean = name.trim();
  if (!clean) throw new Error("Give the brand a name");
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  if (!slug) throw new Error("That name has no letters or numbers in it");
  const db = getAccountsDb();
  if (db.prepare("SELECT 1 FROM brands WHERE slug = ?").get(slug)) throw new Error("A brand already uses that name");
  const dir = path.join("brands", slug);
  fs.mkdirSync(path.join(DATA_DIR, dir, "uploads"), { recursive: true });
  const id = randomUUID();
  db.prepare("INSERT INTO brands (id, slug, name, dir, active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .run(id, slug, clean, dir, new Date().toISOString());
  /* Build its database now rather than on first use, so a brand that has just been added is
     immediately a real place with a calendar in it. */
  openBrandDb(slug, dir);
  return db.prepare("SELECT * FROM brands WHERE id = ?").get(id) as Brand;
}

/* ---- a brand's own database ---- */

function openBrandDb(slug: string, dir: string): Database.Database {
  const root = brandDataDir(slug, dir);
  fs.mkdirSync(path.join(root, "uploads"), { recursive: true });
  const db = new Database(path.join(root, "circuit.db"));
  db.pragma("journal_mode = WAL");
  /* The CREATE block builds a new database in one go; the migrations replay everything that
     came after it against an older one. Both are idempotent, but only the second is
     recorded — so a database can now say which changes it has had, and a copy restored from
     data/backups can be told apart from a fresh install. */
  db.exec(SCHEMA);
  const ran = migrate(db);
  if (ran.length) console.log(`[db] ${slug}: applied ${ran.length} migration(s): ${ran.map((m) => `${m.id} ${m.name}`).join(", ")}`);
  return db;
}

export function getDb(): Database.Database {
  const brand = currentBrand();
  const open = (global.__circuitDbs ??= new Map<string, Database.Database>());
  let db = open.get(brand.slug);
  if (!db) { db = openBrandDb(brand.slug, brand.dir); open.set(brand.slug, db); }
  return db;
}

/* The background worker has to do its rounds for every brand, not only whichever one is on
   screen. It cannot do that by flipping the stored choice: a page load that landed in the
   middle of the worker's BOOMA pass would quietly render BOOMA's calendar under BNC's name.

   So the worker's brand is carried on the async context instead. It applies to the worker's
   own call stack and nothing else — an HTTP request has no store, so it keeps reading the
   brand the person actually chose, whatever the worker is doing at the time. */
const brandContext = new AsyncLocalStorage<Brand>();

export async function forEachBrand<T>(fn: (brand: Brand) => Promise<T>): Promise<{ brand: Brand; result?: T; error?: string }[]> {
  const out: { brand: Brand; result?: T; error?: string }[] = [];
  for (const b of listBrands()) {
    try {
      out.push({ brand: b, result: await brandContext.run(b, () => fn(b)) });
    } catch (e) {
      /* One brand's bad day is not the others'. */
      out.push({ brand: b, error: (e as Error).message });
    }
  }
  return out;
}

/* The brand this code is running for: the worker's, if we are inside one of its passes;
   otherwise the one the person picked. */
export const currentBrand = (): Brand => brandContext.getStore() || activeBrand();

/* Carrying a brand across an HTTP call.

   The worker reaches parts of Circuit through its own API rather than by calling the library
   directly, and an async context does not survive that hop — the route handler starts with no
   store and would answer for whichever brand is on screen. During BNC's pass that meant the
   worker asking for the queue and being handed BOOMA's.

   So the worker names the brand on the request, and the gate re-establishes it here. Only a
   caller holding the per-process internal secret may do that; a browser cannot ask to be
   served another brand's data by adding a header. */
export function runWithBrand<T>(slug: string, fn: () => T): T {
  const b = listBrands().find((x) => x.slug === slug);
  return b ? brandContext.run(b, fn) : fn();
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

/* The columns a file row actually has. The optional ones arrived with later migrations, so a
   row read from an older backup may not carry them. */
export type FileRow = {
  id: string; name: string; mime: string; size: number; path: string; kind: string; created_at: string;
  sha256?: string; rights?: string; tags?: string; title?: string; brand?: number; poster_id?: string | null;
};

const SAFE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  /* Video, because a reel is a post too. The extension matters: Meta and Supabase both decide
     what a file is from it, and a .bin lands as a download rather than a video. */
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/* The same bytes, however they arrived. A sync that re-runs, a shoot uploaded twice, a poster
   remade from the same inputs — all of them produce a byte-identical file under a new name and
   a new id, and nothing but a hash can tell. */
export const hashBuffer = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

export function findByHash(sha: string): FileRow | undefined {
  if (!sha) return undefined;
  return getDb().prepare("SELECT * FROM files WHERE sha256 = ? LIMIT 1").get(sha) as FileRow | undefined;
}

/* Saves the bytes and returns the row.

   `dedupe` makes it return the file already holding these bytes instead of writing a second
   copy. It is off by default because some callers genuinely want their own row — a poster
   rendered twice is two posters even if the pixels match — and silently handing back someone
   else's row would be the wrong kind of clever. The callers that want it ask. */
export function saveFileBuffer(buf: Buffer, name: string, mime: string, kind = "upload", opts: { dedupe?: boolean } = {}): FileRow {
  const sha = hashBuffer(buf);
  if (opts.dedupe) {
    const had = findByHash(sha);
    if (had) return had;
  }
  const id = newId();
  const ext = SAFE_EXT[mime] || (name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin");
  const rel = `${id}.${ext}`;
  fs.mkdirSync(uploadDir(), { recursive: true });
  fs.writeFileSync(path.join(uploadDir(), rel), buf);
  const row: FileRow = { id, name, mime, size: buf.length, path: rel, kind, created_at: now() };
  getDb()
    .prepare("INSERT INTO files (id, name, mime, size, path, kind, created_at, sha256) VALUES (@id, @name, @mime, @size, @path, @kind, @created_at, @sha256)")
    .run({ ...row, sha256: sha });
  return { ...row, sha256: sha };
}

export function getFile(id: string): FileRow | undefined {
  return getDb().prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
}

export function readFileBase64(id: string): { mime: string; data: string } | null {
  const f = getFile(id);
  if (!f) return null;
  const buf = fs.readFileSync(path.join(uploadDir(), f.path));
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
  const full = path.join(uploadDir(), f.path);
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
