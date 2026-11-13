import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* When a repeating post actually falls.

   The date arithmetic is the part worth testing: a weekly series has to land on the same
   weekday regardless of where the window starts, and a monthly one set to the 31st has to do
   something sensible in February rather than skipping the month. datesFor is pure, so the test
   compiles the real module and stubs away the database import it never reaches. */
const src = fs.readFileSync(new URL("../src/lib/series.ts", import.meta.url), "utf8")
  /* A stand-in library, so the readiness check can be tested without a database. `files` is
     what the library is pretending to hold. */
  .replace('import { getDb, newId, now } from "@/lib/db";',
    'export const files = new Map();\n' +
    'const getDb = () => ({ prepare: (sql) => ({ get: (id) => (sql.includes("FROM files") ? files.get(id) : undefined), all: () => [], run: () => ({ changes: 0 }) }), transaction: (f) => f });\n' +
    'const newId = () => "x"; const now = () => "";')
  .replace('import { DAYS } from "@/lib/dates";', 'const DAYS = [];');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "series-")), "series.mjs");
fs.writeFileSync(out, js);
const { datesFor, seriesFault, files } = await import(pathToFileURL(out).href);

const weekly = (weekday, at_time = "18:30") => ({ cadence: "weekly", weekday, day_of_month: 1, at_time });
const monthly = (day_of_month, at_time = "09:00") => ({ cadence: "monthly", weekday: 0, day_of_month, at_time });
const d = (s) => new Date(s);
const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

test("a weekly series lands on its weekday, every week", () => {
  const got = datesFor(weekly(4), d("2026-10-01T00:00:00"), d("2026-10-31T23:59:59"));
  assert.deepEqual(got.map(key), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  for (const x of got) assert.equal(x.getDay(), 4);
});

test("it carries the time of day it was given", () => {
  const [first] = datesFor(weekly(4, "07:05"), d("2026-10-01T00:00:00"), d("2026-10-08T00:00:00"));
  assert.equal(first.getHours(), 7);
  assert.equal(first.getMinutes(), 5);
});

test("starting mid-week does not skip the first occurrence", () => {
  // 5 Oct 2026 is a Monday; the next Thursday is the 8th
  const got = datesFor(weekly(4), d("2026-10-05T00:00:00"), d("2026-10-12T23:59:59"));
  assert.deepEqual(got.map(key), ["2026-10-08"]);
});

test("a monthly series lands on its day", () => {
  const got = datesFor(monthly(1), d("2026-10-01T00:00:00"), d("2026-12-31T23:59:59"));
  assert.deepEqual(got.map(key), ["2026-10-01", "2026-11-01", "2026-12-01"]);
});

test("the 31st becomes the last day of a shorter month, rather than skipping it", () => {
  const got = datesFor(monthly(31), d("2027-01-01T00:00:00"), d("2027-04-30T23:59:59"));
  assert.deepEqual(got.map(key), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("February in a leap year keeps its 29th", () => {
  const got = datesFor(monthly(30), d("2028-02-01T00:00:00"), d("2028-02-29T23:59:59"));
  assert.deepEqual(got.map(key), ["2028-02-29"]);
});

test("a window that contains nothing returns nothing, rather than guessing", () => {
  // Thursday series, window is Friday to Sunday
  assert.deepEqual(datesFor(weekly(4), d("2026-10-02T00:00:00"), d("2026-10-04T23:59:59")), []);
});

test("nonsense settings are clamped, not obeyed", () => {
  assert.equal(datesFor(weekly(99), d("2026-10-01T00:00:00"), d("2026-10-31T23:59:59"))[0].getDay(), 6);
  const m = datesFor(monthly(0), d("2026-10-01T00:00:00"), d("2026-10-31T23:59:59"));
  assert.equal(key(m[0]), "2026-10-01");
});


/* ---- what stops a series producing a usable draft ---- */

const series = (over = {}) => ({ platform: "Instagram", caption: "", file_id: null, ...over });

test("a series with neither a picture nor a caption cannot generate", () => {
  assert.match(seriesFault(series()), /choose a picture, write a caption/);
});

test("a caption alone is enough — not every post is a picture", () => {
  assert.equal(seriesFault(series({ caption: "This week on the Challenger." })), "");
});

test("a picture alone is enough", () => {
  files.set("pic", { mime: "image/jpeg" });
  assert.equal(seriesFault(series({ file_id: "pic" })), "");
});

test("a picture that has since left the library is named as the problem", () => {
  files.clear();
  assert.match(seriesFault(series({ file_id: "gone", caption: "still here" })), /no longer in the library/);
});

test("something that is not a picture is refused even with a caption", () => {
  files.set("doc", { mime: "application/pdf" });
  assert.match(seriesFault(series({ file_id: "doc", caption: "hello" })), /not a picture or a video/);
});

test("a video counts as a picture for this purpose", () => {
  files.set("reel", { mime: "video/mp4" });
  assert.equal(seriesFault(series({ file_id: "reel" })), "");
});
