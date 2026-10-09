import type Database from "better-sqlite3";

/* Schema changes, in order, recorded.

   Circuit grew its schema two ways at once: a big CREATE TABLE IF NOT EXISTS block, and a
   lengthening list of ensureColumn calls bolted on underneath. Both are idempotent, so neither
   was wrong — but together they meant nobody could say what version a given database was at,
   what had already been applied, or in what order. A copy restored from data/backups and a
   fresh install could differ and nothing would notice.

   So: numbered steps, applied once, written down. The CREATE block still runs first and still
   makes a new database in one go; these are the changes that came after it, replayed in order
   against an older file. The point is not ceremony — it is that `schema_migrations` can be
   read, and a database can answer the question "which of these have you had?".

   Rules for adding one: append, never renumber, never edit a shipped step. SQLite can add a
   column but not drop or retype one, so a change of shape is a new table plus a copy, written
   as its own step. */

export type Migration = { id: number; name: string; up: (db: Database.Database) => void };

/* Adding a column is most of what happens, and SQLite has no IF NOT EXISTS for it. */
function addColumn(db: Database.Database, table: string, column: string, decl: string) {
  const exists = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

export const MIGRATIONS: Migration[] = [
  /* 1 collects every ensureColumn that had accumulated in getDb by the time migrations were
     introduced. It is written as one step rather than twenty-three because that is what it
     was: a single undifferentiated state that every existing database already had. Splitting
     it now would invent a history that never happened. */
  {
    id: 1,
    name: "columns added before migrations existed",
    up: (db) => {
      const c = (t: string, col: string, decl: string) => addColumn(db, t, col, decl);
      c("inspirations", "rights", "TEXT NOT NULL DEFAULT ''");
      c("inspirations", "origin", "TEXT NOT NULL DEFAULT ''");
      c("creations", "slot_id", "TEXT");
      c("creations", "round", "INTEGER NOT NULL DEFAULT 0");
      c("creations", "parent_id", "TEXT");
      c("render_jobs", "slot_id", "TEXT");
      c("render_jobs", "round", "INTEGER NOT NULL DEFAULT 0");
      c("render_jobs", "parent_id", "TEXT");
      c("render_jobs", "reference_file", "TEXT");
      c("posts", "slot_id", "TEXT");
      c("pillars", "weight", "INTEGER NOT NULL DEFAULT 20");
      c("pillars", "platforms", "TEXT NOT NULL DEFAULT '[]'");
      c("pillars", "examples", "TEXT NOT NULL DEFAULT '[]'");
      c("research_jobs", "kind", "TEXT NOT NULL DEFAULT 'research'");
      c("research_jobs", "payload", "TEXT NOT NULL DEFAULT '{}'");
      c("render_jobs", "slide_id", "TEXT");
      c("slot_slides", "bg_file_id", "TEXT");
      c("products", "source_path", "TEXT NOT NULL DEFAULT ''");
      c("files", "tags", "TEXT NOT NULL DEFAULT ''");
      c("files", "title", "TEXT NOT NULL DEFAULT ''");
      c("files", "brand", "INTEGER NOT NULL DEFAULT 0");
      c("files", "poster_id", "TEXT");
    },
  },
  {
    id: 2,
    name: "accounts, sessions and sign-off",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL DEFAULT 'marketing', pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
          created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS signoffs (
          post_id TEXT PRIMARY KEY, decision TEXT NOT NULL, by_user TEXT NOT NULL,
          by_name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', caption_hash TEXT NOT NULL,
          decided_at TEXT NOT NULL);`);
    },
  },
  {
    id: 3,
    name: "a post can hold more than one picture",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS post_media (
          post_id TEXT NOT NULL, file_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (post_id, file_id));
        CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, position);`);
    },
  },
  {
    id: 4,
    name: "indexes the queue and the calendar lean on",
    up: (db) => {
      /* Every one of these backs a query that runs on a page load. They were missing because
         nothing is slow at this size — which is exactly when they are cheap to add. */
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_posts_slot ON posts(slot_id);
        CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
        CREATE INDEX IF NOT EXISTS idx_creations_slot ON creations(slot_id);
        CREATE INDEX IF NOT EXISTS idx_runs_workflow ON workflow_runs(workflow_id, status);
        CREATE INDEX IF NOT EXISTS idx_files_brand ON files(brand);`);
    },
  },
];

export type Applied = { id: number; name: string; at: string };

export function migrate(db: Database.Database): Applied[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);

  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
  const ran: Applied[] = [];

  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    /* Each step and its record commit together. A step that half-applied and then claimed to
       be done would be worse than one that never ran, because the next run would skip it. */
    const at = new Date().toISOString();
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, at);
    })();
    ran.push({ id: m.id, name: m.name, at });
  }
  return ran;
}

/* What this database has had, for the health panel and for anybody wondering why a column is
   missing on one machine and present on another. */
export function migrationState(db: Database.Database): { applied: number; latest: number; pending: number[] } {
  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
  return {
    applied: done.size,
    latest: MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].id : 0,
    pending: MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id),
  };
}
