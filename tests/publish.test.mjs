import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Publishing: which page, which permissions, how many slides.

   Everything here is a rule that, when it was wrong, would have put something public and
   unrecoverable in the wrong place. The page one actually was wrong: with nothing pinned,
   page() took the first page the API returned, which on this account is Nemi AI — a different
   company. It was caught by reading the code an hour before the first real publish. */

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-pub-"));
  const db = new Database(path.join(dir, "t.db"));
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
           CREATE TABLE post_media (post_id TEXT NOT NULL, file_id TEXT NOT NULL,
             position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (post_id, file_id));`);
  return db;
}

/* Mirrors publishable() in src/lib/publish.ts. */
function publishable(scopes, hasToken) {
  const have = scopes;
  const unread = hasToken && have.length === 0;
  const need = (list) => (unread ? [] : list.filter((s) => !have.includes(s)));
  const ig = need(["instagram_content_publish"]);
  const fb = need(["pages_manage_posts", "pages_show_list"]);
  return {
    Instagram: { ready: hasToken && !unread && ig.length === 0, missing: ig },
    Facebook: { ready: hasToken && !unread && fb.length === 0, missing: fb },
  };
}

const FULL = ["instagram_basic", "pages_show_list", "instagram_manage_insights",
  "instagram_content_publish", "pages_manage_posts", "instagram_manage_comments"];

test("a token with every scope can publish to both", () => {
  const c = publishable(FULL, true);
  assert.equal(c.Instagram.ready, true);
  assert.equal(c.Facebook.ready, true);
});

test("a token missing a scope names the one it is missing", () => {
  const c = publishable(FULL.filter((s) => s !== "instagram_content_publish"), true);
  assert.equal(c.Instagram.ready, false);
  assert.deepEqual(c.Instagram.missing, ["instagram_content_publish"]);
  assert.equal(c.Facebook.ready, true, "Facebook is unaffected");
});

test("a token whose scopes could not be read is not treated as missing everything", () => {
  /* The likeliest way to reach this is pasting a good token while Meta is briefly
     unreachable, which is exactly when a confident wrong answer costs most. */
  const c = publishable([], true);
  assert.equal(c.Instagram.ready, false);
  assert.deepEqual(c.Instagram.missing, [], "it must not claim a specific scope is absent");
});

test("no token at all is not ready", () => {
  assert.equal(publishable([], false).Instagram.ready, false);
});

/* Mirrors page() in src/lib/publish.ts. */
function pickPage(pages, pinned, igUserId) {
  if (!pages.length) throw new Error("This token does not reach any Facebook page");
  if (pinned) {
    const hit = pages.find((p) => p.id === pinned);
    if (!hit) throw new Error(`The Facebook page set in Settings (${pinned}) is not on this token.`);
    return hit;
  }
  if (igUserId) {
    const owner = pages.find((p) => p.instagram_business_account?.id === igUserId);
    if (owner) return owner;
  }
  throw new Error("Set which Facebook page to post to");
}

const PAGES = [
  { id: "1142896255576549", name: "Nemi AI", instagram_business_account: { id: "17841422854372056" } },
  { id: "789337794264541", name: "Booma Motors Delhi", instagram_business_account: { id: "17841476778007323" } },
  { id: "108993001267446", name: "BNC", instagram_business_account: { id: "17841446525577665" } },
];
const BNC_IG = "17841446525577665";

test("with a page pinned, that page is used", () => {
  assert.equal(pickPage(PAGES, "108993001267446", BNC_IG).name, "BNC");
});

test("with nothing pinned it follows the Instagram account, not the first page", () => {
  /* The first page on this account is Nemi AI — a different company. */
  assert.equal(pickPage(PAGES, null, BNC_IG).name, "BNC");
});

test("a pinned page that is not on the token is an error, not a silent switch", () => {
  assert.throws(() => pickPage(PAGES, "999", BNC_IG), /not on this token/);
});

test("when the page cannot be established the post stops", () => {
  assert.throws(() => pickPage(PAGES, null, null), /Set which Facebook page/);
});

/* Slides. */
const CAROUSEL_MAX = 10;
const mediaFor = (db, postId) =>
  db.prepare("SELECT file_id FROM post_media WHERE post_id=? ORDER BY position").all(postId).map((r) => r.file_id);

test("slides come back in the order they were set", () => {
  const db = freshDb();
  ["c", "a", "b"].forEach((f, i) =>
    db.prepare("INSERT INTO post_media (post_id,file_id,position) VALUES ('p1',?,?)").run(f, i));
  assert.deepEqual(mediaFor(db, "p1"), ["c", "a", "b"]);
});

test("a post with no slides falls back to its single picture", () => {
  const db = freshDb();
  const slides = mediaFor(db, "p1");
  const used = slides.length ? slides.slice(0, CAROUSEL_MAX) : ["only-image"];
  assert.deepEqual(used, ["only-image"]);
});

test("more than ten slides is trimmed to Meta's limit", () => {
  const db = freshDb();
  for (let i = 0; i < 14; i += 1) {
    db.prepare("INSERT INTO post_media (post_id,file_id,position) VALUES ('p1',?,?)").run(`f${i}`, i);
  }
  assert.equal(mediaFor(db, "p1").slice(0, CAROUSEL_MAX).length, 10);
});
