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
  {
    id: 16,
    name: "a piece of work knows what Circuit can do about it",
    up: (db) => {
      /* A task used to be a row you looked at: a title, two dates and a percentage, pointing at
         nothing. Circuit already had the better idea in `slots`, which carry what stage the work
         is at and what is needed next, and the board was a second task system that duplicated
         the idea and did none of the work.

         `door` names what Circuit can do about this piece of work — draft it, fill it, go and
         read something — or which screen does it when the answer is a person. Blank on a task
         somebody typed themselves, which honestly has no door until they say otherwise. */
      addColumn(db, "tasks", "door", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    id: 17,
    name: "conversations worth joining on LinkedIn and X",
    up: (db) => {
      /* The other half of listening. `comments` holds what people said on our posts; this holds
         other people's posts that are worth replying to — somebody asking about range anxiety,
         a fleet operator weighing electric, a competitor's launch thread.

         The link is the point. Circuit cannot read LinkedIn or X directly — both block
         everything that is not a browser, and automating either is against their terms and
         against this project's own rules — so it finds them through search, keeps the link, and
         drafts what we would say. A person opens the link and posts it. Nothing is ever sent
         from here.

         `reachable` records what happened when Circuit tried the link: a search can return a URL
         that does not exist, and a list of ten plausible dead links is worse than an empty one. */
      db.exec(`CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        said TEXT NOT NULL DEFAULT '',
        topic TEXT NOT NULL DEFAULT '',
        why TEXT NOT NULL DEFAULT '',
        reachable TEXT NOT NULL DEFAULT 'unchecked',
        draft TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        found_at TEXT NOT NULL,
        drafted_at TEXT,
        updated_at TEXT NOT NULL
      )`);
      /* One row per link: the same post found by two searches is one conversation. */
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS conversations_url ON conversations (url)");
      db.exec("CREATE INDEX IF NOT EXISTS conversations_state ON conversations (status, found_at)");
    },
  },
  {
    id: 18,
    name: "five ways to answer a post, not one",
    up: (db) => {
      /* One draft meant taking it or asking for another, and the second attempt was usually the
         first one reworded. Five written at once, each from a different angle — a practical
         answer, a number, a question back, agreement that adds something, a polite disagreement
         — give a real choice, and picking between them takes seconds where judging a single
         draft in isolation takes minutes.

         `chosen` is the index of the one that was used, or -1. Kept rather than only copying the
         text into `draft`, so it is possible to see later which kind of comment actually gets
         replies. */
      addColumn(db, "conversations", "options", "TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, "conversations", "chosen", "INTEGER NOT NULL DEFAULT -1");
      /* Written as the brand or as a person. A company page comment reaches a fraction of what
         a person's does on LinkedIn, so which one this was written for changes the words. */
      addColumn(db, "conversations", "voice", "TEXT NOT NULL DEFAULT 'brand'");
    },
  },
  {
    id: 19,
    name: "the post itself, not a summary of it",
    up: (db) => {
      /* The comments were written from Circuit's own two-sentence précis of a post, which is why
         they came out generic: a paraphrase keeps the subject and loses every specific, and the
         specifics are the only thing a comment can usefully answer.

         Both platforms publish an embed for exactly this purpose — LinkedIn at
         /embed/feed/update/urn:li:activity:ID and X through publish.twitter.com/oembed — and
         both hand over the full text to a plain request. That is their sanctioned route, not a
         way round the wall, and it also turns the link check into a real one: a post whose text
         comes back exists, which a status code from LinkedIn could never establish. */
      addColumn(db, "conversations", "full_text", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "conversations", "embed", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    id: 20,
    name: "a post's picture, where it has one",
    up: (db) => {
      /* The embed shows a post's image by itself, but the card around it could not: a text post
         and a post built around a photograph looked identical in the list, and which it is
         changes both whether it is worth commenting on and what the comment should say.

         The URL is kept, not the file. These are other people's pictures on their own CDN —
         downloading them would be making a copy of somebody's work for no reason, and the
         rights line on it would be a lie. */
      addColumn(db, "conversations", "image", "TEXT NOT NULL DEFAULT ''");
    },
  },
  /* 21: the Learning tests. The bank holds questions and their key; an attempt fixes which
     questions a test asked when it starts, so the key is only read when it is handed in. */
  {
    id: 21,
    name: "learning questions and test attempts",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS learning_questions (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', question TEXT NOT NULL,
        options TEXT NOT NULL, answer INTEGER NOT NULL, why TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL)`);
      db.exec(`CREATE TABLE IF NOT EXISTS learning_attempts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
        question_ids TEXT NOT NULL, orders TEXT NOT NULL DEFAULT '[]', answers TEXT, score INTEGER, total INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, finished_at TEXT)`);
      db.exec("CREATE INDEX IF NOT EXISTS learning_attempts_user ON learning_attempts (user_id, finished_at)");
    },
  },
  /* 22: how many of a stock item get used in a month, so what is left can be worked out
     between counts rather than only known on the day somebody counts. */
  {
    id: 22,
    name: "stock usage per month",
    up: (db) => addColumn(db, "stock", "per_month", "REAL NOT NULL DEFAULT 0"),
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
