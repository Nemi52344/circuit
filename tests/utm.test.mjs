import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* Link tagging, tested against the real module rather than a copy of it.

   The other tests here reimplement what they check, because this Node cannot import a .ts
   file and the things they test are tangled up with the database anyway. This module is not:
   it has no imports and touches nothing, so the compiler that already builds the app can hand
   the test the actual source. A second copy of a URL-building rule is exactly the kind of
   thing that stays right for a month and then quietly does not. */
const src = fs.readFileSync(new URL("../src/lib/utm.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "utm-")), "utm.mjs");
fs.writeFileSync(out, js);
const { taggedLink, sourceFor, slug, linkFault } = await import(pathToFileURL(out).href);

test("the source follows from the platform, never from typing", () => {
  assert.equal(sourceFor("Instagram"), "instagram");
  assert.equal(sourceFor("X"), "x");
  assert.equal(sourceFor("Twitter"), "x");            // one name for one place
  assert.equal(sourceFor("Google Business"), "google-business");
  assert.equal(sourceFor(""), "social");
});

test("a link keeps the query it already had", () => {
  const out = taggedLink({ platform: "Instagram", scheduled_at: "2026-10-12T13:00:00.000Z",
    link_url: "https://bncmotors.in/challenger?colour=black" });
  const u = new URL(out);
  assert.equal(u.searchParams.get("colour"), "black");
  assert.equal(u.searchParams.get("utm_source"), "instagram");
  assert.equal(u.searchParams.get("utm_medium"), "social");
  assert.equal(u.searchParams.get("utm_campaign"), "2026-10");
});

test("the post's own platform wins over a utm already on the link", () => {
  const out = taggedLink({ platform: "LinkedIn", scheduled_at: "2026-10-12T13:00:00.000Z",
    link_url: "https://bncmotors.in/?utm_source=facebook" });
  assert.equal(new URL(out).searchParams.get("utm_source"), "linkedin");
});

test("a bare host is treated as https, not as a broken link", () => {
  assert.ok(taggedLink({ platform: "X", scheduled_at: "2026-10-12T13:00:00.000Z", link_url: "bncmotors.in" })
    .startsWith("https://bncmotors.in/"));
});

test("no destination means no tagged link, not a tagged empty one", () => {
  assert.equal(taggedLink({ platform: "X", scheduled_at: "2026-10-12T13:00:00.000Z", link_url: "" }), "");
  assert.equal(taggedLink({ platform: "X", scheduled_at: "2026-10-12T13:00:00.000Z" }), "");
});

test("a set campaign beats the month, and is slugged", () => {
  const u = new URL(taggedLink({ platform: "Instagram", scheduled_at: "2026-10-12T13:00:00.000Z",
    link_url: "https://bncmotors.in", utm_campaign: "Festive Offer 2026!", utm_content: "Reel one" }));
  assert.equal(u.searchParams.get("utm_campaign"), "festive-offer-2026");
  assert.equal(u.searchParams.get("utm_content"), "reel-one");
});

test("rubbish is named as rubbish rather than silently dropped", () => {
  assert.equal(linkFault(""), "");
  assert.equal(linkFault("https://bncmotors.in"), "");
  assert.notEqual(linkFault("not a url at all"), "");
  assert.equal(slug("Challenger 110 — Black"), "challenger-110-black");
});
