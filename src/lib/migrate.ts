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
  {
    id: 5,
    name: "inspirations can hold the video, not just its poster frame",
    up: (db) => {
      /* A reel arrived as a single JPEG, because the Instagram read asked for thumbnail_url
         first and dropped media_url — the MP4 — on the floor. The still was all that was ever
         saved, so half the swipe file was a wall of frozen first frames with no way to see
         what the thing actually did. The poster stays in file_id, where every existing row
         already has it; the video goes here, beside it. */
      addColumn(db, "inspirations", "video_file_id", "TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_inspirations_video ON inspirations(video_file_id);");
    },
  },
  {
    id: 6,
    name: "a creation carries the checks made before it was approved",
    up: (db) => {
      /* Four things somebody has to actually look at before a picture goes out: is the product
         right, is the logo right, can the words be read, and are we allowed to use it. They
         were being carried in somebody's head, which is where they stay until the one time
         they do not. Stored as JSON on the creation so the answer travels with the picture. */
      addColumn(db, "creations", "qa", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    id: 7,
    name: "a file knows what it is allowed to be used for, and whether it is already here",
    up: (db) => {
      /* Inspirations have carried a rights line since early on; the files they produce never
         did. So a picture could be lifted out of the library months later with nothing on it
         to say it was a competitor's and must not be published. */
      addColumn(db, "files", "rights", "TEXT NOT NULL DEFAULT ''");

      /* The same picture arriving twice is not a hypothetical: a sync re-runs, somebody
         re-uploads a shoot, a poster gets remade. A hash of the bytes is the only way to know
         it is the same picture when the name, the date and the id all differ. Existing rows
         have none and are filled in as they are touched, so the column means "what we have
         hashed so far" rather than "all of them". */
      addColumn(db, "files", "sha256", "TEXT NOT NULL DEFAULT ''");
      db.exec("CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256);");
    },
  },
  {
    id: 8,
    name: "files inherit the rights line of the inspiration they came from",
    up: (db) => {
      /* Every saved inspiration already carries a rights line — usually "Third-party.
         Reference only, do not publish." The file underneath it never did, so the moment a
         picture was looked at in the Library rather than in Inspiration, that warning was
         gone. The files know now, for everything already here. */
      db.exec(`
        UPDATE files SET rights = (
          SELECT i.rights FROM inspirations i
          WHERE (i.file_id = files.id OR i.video_file_id = files.id) AND COALESCE(i.rights, '') != ''
          LIMIT 1
        )
        WHERE COALESCE(rights, '') = ''
          AND EXISTS (
            SELECT 1 FROM inspirations i
            WHERE (i.file_id = files.id OR i.video_file_id = files.id) AND COALESCE(i.rights, '') != ''
          );`);

      /* Anything the brand made is ours to publish, and saying so is what makes the field
         useful rather than a column that is blank on nine rows in ten. */
      db.exec(`UPDATE files SET rights = 'Ours, free to publish'
               WHERE COALESCE(rights, '') = '' AND (brand = 1 OR kind IN ('product', 'generated', 'export', 'own_post'));`);

      /* Briefings, invoices and statements are not creative: they are the company's own
         paperwork, and the warning they need is the opposite one. */
      db.exec(`UPDATE files SET rights = 'Internal. Not for publication.'
               WHERE COALESCE(rights, '') = '' AND kind IN ('intel', 'bill', 'statement', 'receipt', 'document');`);
    },
  },
  {
    id: 9,
    name: "an agent remembers whether it last worked",
    up: (db) => {
      /* Seven agents are defined and nothing anywhere said which of them had ever run, let
         alone whether it succeeded. "Which bots are working" was a question the app held all
         the parts to answer and could not. */
      addColumn(db, "agents", "last_run", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "agents", "last_ok", "INTEGER");
      addColumn(db, "agents", "last_error", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "agents", "last_seconds", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "agents", "runs", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "agents", "fails", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    id: 10,
    name: "a published post can be kept as a model or set aside",
    up: (db) => {
      /* The app reads what its own posts did and draws conclusions from them. What it could
         not do was take a correction: a post that did well for a reason that will not repeat —
         a festival, a cricket result, somebody else's news — still pulled the advice towards
         itself, and there was no way to say "not that one".

         "keep" marks a post as a model worth suggesting from. "set aside" takes it out of the
         learning without deleting it, because the numbers are still true, they are just not a
         lesson. Null is the normal state: nobody has said either way. */
      addColumn(db, "own_posts", "verdict", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "own_posts", "verdict_why", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "own_posts", "verdict_at", "TEXT NOT NULL DEFAULT ''");
      db.exec("CREATE INDEX IF NOT EXISTS idx_own_posts_verdict ON own_posts(verdict);");
    },
  },
  {
    id: 11,
    name: "work carries how long it was expected to take, and how long it did",
    up: (db) => {
      /* Circuit could say what it had done and never how long any of it took. That made one
         question unanswerable — what proportion of marketing actually runs by itself — and it
         is the question the whole automation effort exists to answer.

         Two numbers per task, both in minutes, both optional. An estimate is a guess made
         before; spent is what it really was. Neither is required, because a queue that
         refuses work without a time estimate is a queue people stop using. */
      addColumn(db, "tasks", "estimate_minutes", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "tasks", "spent_minutes", "INTEGER NOT NULL DEFAULT 0");
      /* Whether this is work a person must do, or work the app could take over. Left blank
         until somebody says, because guessing it would make the automation figure a fiction. */
      addColumn(db, "tasks", "doable_by", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    id: 12,
    name: "a creation can be talked about, and its earlier versions found",
    up: (db) => {
      /* Two people looking at the same picture had nowhere to disagree.

         Rejecting it recorded that it was rejected and not one word about why, so the next
         round repeated the same mistake. A note is attached to the creation rather than kept
         in a chat, because the reason a picture was turned down is only useful next to the
         picture.

         Versions already existed — iterating a draft has been writing parent_id and round
         since September — but nothing ever read them back, so a round-two picture looked
         exactly like an unrelated one. Nothing to migrate: the chains are already in the
         table, and this is the index that makes walking them cheap. */
      db.exec(`CREATE TABLE IF NOT EXISTS creation_notes (
        id TEXT PRIMARY KEY,
        creation_id TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS creation_notes_on ON creation_notes (creation_id, created_at)");
      db.exec("CREATE INDEX IF NOT EXISTS creations_parent ON creations (parent_id)");
    },
  },
  {
    id: 13,
    name: "a post can carry a tagged link to the website",
    up: (db) => {
      /* A post that sends people to the website had no way of saying so, which made the one
         question worth asking about it — did anybody go — unanswerable.

         Three columns, not a table: a post links to at most one place, and a join for a single
         string is a table nobody would thank us for. Source and medium are not stored because
         they follow from the platform; storing them would let them drift out of agreement with
         the post they describe. */
      addColumn(db, "posts", "link_url", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "posts", "utm_campaign", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "posts", "utm_content", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    id: 14,
    name: "a post can repeat on a schedule",
    up: (db) => {
      /* The things that go out every week whether or not anybody plans them — Thursday's reel,
         the dealer post on the first of the month. They were being typed in one at a time, and
         the ones that got missed were missed quietly.

         A series writes posts; it does not become one. Each generated post is an ordinary draft
         that can be edited, moved or deleted without the series arguing, because a calendar that
         keeps restoring what you removed is worse than one that forgets. The series_id is there
         so Circuit knows what it already made, and so a post survives its series being deleted. */
      db.exec(`CREATE TABLE IF NOT EXISTS series (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        cadence TEXT NOT NULL DEFAULT 'weekly',
        weekday INTEGER NOT NULL DEFAULT 4,
        day_of_month INTEGER NOT NULL DEFAULT 1,
        at_time TEXT NOT NULL DEFAULT '18:30',
        caption TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      addColumn(db, "posts", "series_id", "TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS posts_series ON posts (series_id, scheduled_at)");
    },
  },
  {
    id: 15,
    name: "a repeating post can carry a picture of its own",
    up: (db) => {
      /* A series was making drafts with nothing on them. Eight Thursdays of a blank post is
         eight things to open and fill in, which is the work the series was supposed to remove.

         The picture is chosen once on the series and copied onto each draft, rather than the
         draft pointing back at the series: a draft is meant to be editable, and a post that
         silently changed picture because somebody edited the series months later would be a
         change nobody asked for and nobody would see. */
      addColumn(db, "series", "file_id", "TEXT");
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
