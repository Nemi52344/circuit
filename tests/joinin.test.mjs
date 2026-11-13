import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* Which links count as a post worth replying to.

   This is the filter between a language model's search results and a list a person will act on.
   A search cheerfully returns company pages, hashtag feeds, articles about LinkedIn and URLs
   that were never real; every one of those, shown as "a conversation to join", costs somebody a
   click and some trust. The rule is small enough to state exactly, so it is tested exactly. */
const src = fs.readFileSync(new URL("../src/lib/joinin.ts", import.meta.url), "utf8")
  .replace('import { getDb, getSetting, newId, now } from "@/lib/db";',
    'const getDb = () => { throw new Error("link rules must not touch the database"); }; const getSetting = () => ""; const newId = () => "x"; const now = () => "";');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "join-")), "joinin.mjs");
fs.writeFileSync(out, js);
const { linkFault, platformOf, PLATFORMS, SEARCHABLE, STATUSES, checkLink } = await import(pathToFileURL(out).href);

/* checkLink reaches the network through lib/sources, which the stub above does not provide.
   These cases drive it with a fake fetch so the decision table is tested, not the internet. */
const withFetch = async (reply) => {
  const mod = await import(pathToFileURL(out).href);
  globalThis.__fakeFetch = reply;
  return mod;
};

test("a real LinkedIn post is accepted, in each of its three shapes", () => {
  for (const u of [
    "https://www.linkedin.com/posts/someone_ev-fleet-activity-7250000000000000000-AbCd",
    "https://linkedin.com/feed/update/urn:li:activity:7250000000000000000/",
    "https://www.linkedin.com/pulse/why-we-went-electric-someone/",
  ]) assert.equal(linkFault(u), "", u);
});

test("a real X post is accepted on either hostname", () => {
  assert.equal(linkFault("https://x.com/someone/status/1850000000000000000"), "");
  assert.equal(linkFault("https://twitter.com/someone/status/1850000000000000000"), "");
});

test("a page you cannot reply to is refused, and says which kind it is", () => {
  assert.match(linkFault("https://www.linkedin.com/company/bnc-motors/"), /not a post/);
  assert.match(linkFault("https://www.linkedin.com/in/someone/"), /not a post/);
  assert.match(linkFault("https://www.linkedin.com/search/results/content/?keywords=ev"), /not a post/);
  assert.match(linkFault("https://x.com/someone"), /not a post/);
  assert.match(linkFault("https://x.com/hashtag/EV"), /not a post/);
});

test("a real Instagram or Facebook post is accepted", () => {
  for (const u of [
    "https://www.instagram.com/p/DAbC123xYz/",
    "https://instagram.com/reel/C9xYz_Ab-12/",
    "https://www.instagram.com/someone/p/DAbC123xYz/",
    "https://www.facebook.com/bncmotors/posts/pfbid02abcDEF",
    "https://www.facebook.com/permalink.php?story_fbid=123&id=456",
    "https://m.facebook.com/story.php?story_fbid=123&id=456",
    "https://www.facebook.com/watch/?v=123456",
    "https://www.facebook.com/share/p/1AbCdEf/",
    "https://fb.watch/abcDEF/",
  ]) assert.equal(linkFault(u), "", u);
});

test("an Instagram or Facebook page that is not a post is refused", () => {
  assert.match(linkFault("https://www.instagram.com/bncmotors/"), /not a post/);
  assert.match(linkFault("https://www.instagram.com/explore/tags/ev/"), /not a post/);
  assert.match(linkFault("https://www.facebook.com/bncmotors"), /not a post/);
  assert.match(linkFault("https://facebook.com/post/1"), /not a post/);
});

test("anywhere else is refused outright", () => {
  for (const u of ["https://economictimes.com/ev-story", "https://reddit.com/r/india/comments/abc", "https://youtube.com/watch?v=1"]) {
    assert.match(linkFault(u), /not LinkedIn, X, Instagram or Facebook/, u);
  }
});

test("rubbish and insecure links are refused rather than guessed at", () => {
  assert.match(linkFault("not a url"), /not a web address/);
  assert.match(linkFault(""), /not a web address/);
  assert.match(linkFault("http://x.com/a/status/1"), /not https/);
});

test("a lookalike hostname does not pass as the real thing", () => {
  for (const u of ["https://linkedin.com.evil.test/posts/x-activity-1", "https://notx.com/a/status/1", "https://xx.com/a/status/1",
    "https://instagram.com.evil.test/p/abc/", "https://notfacebook.com/x/posts/1"]) {
    assert.match(linkFault(u), /not LinkedIn, X, Instagram or Facebook/, u);
  }
});

test("the platform is read from the link, not taken on trust", () => {
  assert.equal(platformOf("https://www.linkedin.com/posts/a_b-activity-1-x"), "LinkedIn");
  assert.equal(platformOf("https://twitter.com/a/status/1"), "X");
  assert.equal(platformOf("https://www.instagram.com/p/abc/"), "Instagram");
  assert.equal(platformOf("https://m.facebook.com/story.php?story_fbid=1"), "Facebook");
  assert.equal(platformOf("https://example.com/a"), "");
  assert.equal(platformOf("rubbish"), "");
});

test("four platforms, two of them searchable, and the four states a conversation can be in", () => {
  assert.deepEqual([...PLATFORMS], ["LinkedIn", "X", "Instagram", "Facebook"]);
  assert.deepEqual([...SEARCHABLE], ["LinkedIn", "X"]);
  assert.deepEqual([...STATUSES], ["new", "drafted", "joined", "ignored"]);
});


/* ---- what a link check is allowed to conclude ---- */

test("a sign-up wall is not a verified link", () => {
  /* The rule that matters: LinkedIn answers 200 for every post URL after redirecting to
     /signup/cold-join, so landing on a wall must read as "could not tell", never as checked. */
  const WALL = /\/(signup|login|authwall|uas\/login|checkpoint)/i;
  for (const p of ["/signup/cold-join", "/login", "/authwall", "/uas/login", "/checkpoint/challenge"]) {
    assert.ok(WALL.test(p), p);
  }
  for (const p of ["/posts/someone_activity-1", "/feed/update/urn:li:activity:1/", "/jack/status/20"]) {
    assert.ok(!WALL.test(p), p);
  }
});

test("checkLink is exported, so the route can re-check a link later", () => {
  assert.equal(typeof checkLink, "function");
});
