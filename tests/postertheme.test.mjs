import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* The look a poster is printed in.

   posterHtml only builds a string, so the test compiles the real module and stubs away the
   database it asks about photographs. What is worth pinning down is the part nobody would
   notice until a poster had gone out: which brand line a look brings, that a typed wordmark
   replaces it whole, and that an unknown look falls back rather than printing unstyled. */
const src = fs.readFileSync(new URL("../src/lib/poster.ts", import.meta.url), "utf8")
  .replace('import { getDb, newId, now, saveFileBuffer, getFile, tryFilePath } from "@/lib/db";',
    'const getFile = (id) => (id === "have" ? { id } : undefined); const tryFilePath = () => ""; const getDb = () => null, newId = () => "", now = () => "", saveFileBuffer = () => null;')
  .replace('import { chromePath } from "@/lib/intelpdf";', 'const chromePath = () => "";');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "circuit-postertheme-")), "poster.mjs");
fs.writeFileSync(file, js);
const { posterHtml, THEMES, DEFAULT_THEME, themeOf } = await import(pathToFileURL(file).href);

const base = { template: "load", size: "post", number: "200", unit: "kg" };
const markOf = (html) => html.match(/<div class="mark">(.*?)<\/div>/)[1].replace(/<span class="logo"><\/span>/, "").replace(/<\/?i>/g, "");
const siteOf = (html) => html.match(/<div class="sig"><span>(.*?)<\/span>/)[1];

test("NEMI is the look a poster gets when none is asked for", () => {
  assert.equal(DEFAULT_THEME, "nemi");
  assert.equal(themeOf(undefined).id, "nemi");
  assert.equal(themeOf("purple").id, "nemi");
  assert.deepEqual(THEMES.map((t) => t.id), ["nemi", "nemi-light", "bnc"]);
});

test("each look brings its own wordmark and address", () => {
  assert.equal(markOf(posterHtml({ ...base, theme: "nemi" })), "NEMI LMM");
  assert.equal(siteOf(posterHtml({ ...base, theme: "nemi-light" })), "nemilmm.com");
  assert.equal(markOf(posterHtml({ ...base, theme: "bnc" })), "BNC Challenger");
  assert.equal(markOf(posterHtml({ ...base, template: "hiring", headline: "Engineer", theme: "bnc" })), "BNC Motors");
  assert.equal(siteOf(posterHtml({ ...base, theme: "bnc" })), "bncmotors.in");
});

test("a typed wordmark replaces the look's own, second word and all", () => {
  assert.equal(markOf(posterHtml({ ...base, theme: "nemi", mark: "BNC" })), "BNC");
  assert.equal(markOf(posterHtml({ ...base, theme: "nemi", mark: "BNC", mark_tail: "Challenger" })), "BNC Challenger");
  assert.equal(siteOf(posterHtml({ ...base, theme: "nemi", site: "bncmotors.in" })), "bncmotors.in");
  /* The NEMI glyph belongs to the NEMI name, not to the look. */
  assert.ok(posterHtml({ ...base, theme: "nemi" }).includes('<span class="logo"></span>'));
  assert.ok(!posterHtml({ ...base, theme: "nemi", mark: "BNC" }).includes('<span class="logo"></span>'));
  assert.ok(!posterHtml({ ...base, theme: "bnc" }).includes('<span class="logo"></span>'));
});

test("NEMI keeps to one accent, and the two grounds differ", () => {
  const dark = posterHtml({ ...base, theme: "nemi" }), bone = posterHtml({ ...base, theme: "nemi-light" });
  for (const html of [dark, bone]) { assert.ok(html.includes("#10A37E")); assert.ok(!html.includes("#A8BF6A")); }
  assert.ok(dark.includes("background:#070707")); assert.ok(bone.includes("background:#FEFEFE"));
  assert.ok(posterHtml({ ...base, theme: "bnc" }).includes("#A8BF6A"));
  /* A figure to be read gets the blueprint grid; a statement gets the wash and the corner ticks. */
  assert.ok(dark.includes('class="tick tl"'));
  assert.ok(!posterHtml({ ...base, template: "fact", headline: "x", theme: "nemi" }).includes('class="tick tl"'));
  assert.ok(!bone.includes('class="tick tl"'));
});

test("the preview asks for the photograph by URL, never by a path on the Mac", () => {
  const html = posterHtml({ ...base, theme: "nemi", photo_file_id: "have" }, { web: true });
  assert.ok(html.includes('src="/api/files/have"'));
  assert.ok(!html.includes("file://"));
  assert.ok(!posterHtml({ ...base, photo_file_id: "gone" }, { web: true }).includes("<img"));
});
