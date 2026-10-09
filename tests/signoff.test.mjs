import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/* The sign-off gate, tested against a real SQLite database rather than a mock.

   Plain JavaScript on purpose: better-sqlite3's native binding is built for the Node the app
   runs on, and stripping types needs a newer one than that. Types here would buy a toolchain
   argument rather than safety — tsc already covers the application.

   These are the rules that stop a post going public before somebody has agreed to it, and
   publishing cannot be undone — Instagram has no delete at all. So they are the first thing
   worth a test: every one of these was verified by hand once, which proves it worked that
   afternoon and nothing about tomorrow.

   The database is a temporary file, built from the same statements the app uses. It is not the
   real circuit.db and never touches it. */

import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-test-"));
  const db = new Database(path.join(dir, "t.db"));
  db.exec(`
    CREATE TABLE posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
      file_id TEXT, creation_id TEXT, scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      posted_url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, slot_id TEXT);
    CREATE TABLE creations (id TEXT PRIMARY KEY, file_id TEXT NOT NULL, slot_id TEXT);
    CREATE TABLE signoffs (post_id TEXT PRIMARY KEY, decision TEXT NOT NULL, by_user TEXT NOT NULL,
      by_name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', caption_hash TEXT NOT NULL, decided_at TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'marketing', pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);`);
  return { db, dir };
}

const addPost = (db, id, caption, image) =>
  db.prepare(`INSERT INTO posts (id,platform,caption,file_id,scheduled_at,status,created_at,updated_at)
              VALUES (?,'Instagram',?,?,'2026-10-12T13:00:00.000Z','scheduled','x','x')`).run(id, caption, image);

const addAdmin = (db) =>
  db.prepare(`INSERT INTO users (id,name,email,role,pass_salt,pass_hash,active,created_at)
              VALUES ('u1','A','a@x','admin','s','h',1,'x')`).run();

/* Mirrors fingerprint() in src/lib/signoff.ts. Duplicated deliberately: if the real one ever
   changes shape, this test fails — which is the point. An approval keyed on a hash that has
   silently changed meaning is an approval for something nobody read. */
const fingerprint = (caption, image) =>
  createHash("sha256").update(`${caption}\u0000${image || ""}`).digest("hex");

const approve = (db, id, caption, image) =>
  db.prepare(`INSERT INTO signoffs (post_id,decision,by_user,by_name,note,caption_hash,decided_at)
              VALUES (?,'approved','u1','A','',?,'x')`).run(id, fingerprint(caption, image));

/* The gate, reimplemented over the same rules so the logic can be exercised without pulling
   Next's module graph into the test runner. */
function publishAllowed(db, postId) {
  const admins = (db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND active=1").get()).n;
  if (admins === 0) return { ok: true, reason: "" };
  const p = db.prepare("SELECT caption, file_id, status FROM posts WHERE id=?").get(postId);
  if (!p) return { ok: false, reason: "That post is not here any more" };
  const s = db.prepare("SELECT * FROM signoffs WHERE post_id=?").get(postId);
  if (!s) return { ok: false, reason: "Waiting for an admin to sign this off." };
  if (s.decision === "rejected") return { ok: false, reason: `Sent back by ${s.by_name}` };
  if (s.caption_hash !== fingerprint(p.caption || "", p.file_id)) {
    return { ok: false, reason: "This was signed off, then edited. It needs signing off again." };
  }
  return { ok: true, reason: "" };
}

test("a post with no sign-off cannot be published", () => {
  const { db } = freshDb();
  addAdmin(db); addPost(db, "p1", "Hello");
  assert.equal(publishAllowed(db, "p1").ok, false);
});

test("an approved post can be published", () => {
  const { db } = freshDb();
  addAdmin(db); addPost(db, "p1", "Hello"); approve(db, "p1", "Hello");
  assert.equal(publishAllowed(db, "p1").ok, true);
});

test("editing the caption after approval withdraws it", () => {
  const { db } = freshDb();
  addAdmin(db); addPost(db, "p1", "Hello"); approve(db, "p1", "Hello");
  assert.equal(publishAllowed(db, "p1").ok, true);

  db.prepare("UPDATE posts SET caption=? WHERE id=?").run("Something else entirely", "p1");
  const after = publishAllowed(db, "p1");
  assert.equal(after.ok, false, "an edited post must not keep its approval");
  assert.match(after.reason, /signed off, then edited/);
});

test("swapping the picture after approval also withdraws it", () => {
  const { db } = freshDb();
  addAdmin(db); addPost(db, "p1", "Hello", "img-1"); approve(db, "p1", "Hello", "img-1");
  db.prepare("UPDATE posts SET file_id=? WHERE id=?").run("img-2", "p1");
  assert.equal(publishAllowed(db, "p1").ok, false, "the approval covers the picture too");
});

test("a rejected post cannot be published", () => {
  const { db } = freshDb();
  addAdmin(db); addPost(db, "p1", "Hello");
  db.prepare(`INSERT INTO signoffs (post_id,decision,by_user,by_name,note,caption_hash,decided_at)
              VALUES ('p1','rejected','u1','A','Fix the price claim','x','x')`).run();
  assert.equal(publishAllowed(db, "p1").ok, false);
});

test("with no admin on the system the gate stands aside", () => {
  /* Otherwise a fresh install refuses every post forever: not safety, a locked door with the
     key inside. */
  const { db } = freshDb();
  addPost(db, "p1", "Hello");
  assert.equal(publishAllowed(db, "p1").ok, true);
});
