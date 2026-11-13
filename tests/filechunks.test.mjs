import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* Files live in the database as fixed-size chunks; a video being scrubbed reads only the chunks
   that hold the bytes asked for. The arithmetic is small enough to state exactly. */
const src = fs.readFileSync(new URL("../src/lib/filechunks.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "chunks-")), "filechunks.mjs");
fs.writeFileSync(out, js);
const c = await import(pathToFileURL(out).href);

test("every file takes at least one chunk, and exactly as many as it needs", () => {
  assert.equal(c.chunkCount(0, 10), 1);
  assert.equal(c.chunkCount(10, 10), 1);
  assert.equal(c.chunkCount(11, 10), 2);
  assert.equal(c.chunkCount(c.CHUNK * 3), 3);
});

test("a byte range reads only the chunks that hold it, sliced exactly", () => {
  const data = Buffer.from(Array.from({ length: 35 }, (_, i) => i));
  const chunks = [0, 1, 2, 3].map((n) => data.subarray(n * 10, n * 10 + 10));
  for (const [start, end] of [[0, 0], [0, 34], [5, 14], [9, 10], [10, 19], [12, 31], [30, 34]]) {
    const spans = c.chunkSpans(start, end, 10);
    const got = Buffer.concat(spans.map((s) => chunks[s.n].subarray(s.from, s.to)));
    assert.deepEqual(got, data.subarray(start, end + 1), `${start}-${end}`);
  }
  assert.deepEqual(c.chunkSpans(5, 4, 10), []);
});

test("range headers are read the way a video player sends them", () => {
  assert.deepEqual(c.parseRange("bytes=0-", 1000), { start: 0, end: 999 });
  assert.deepEqual(c.parseRange("bytes=100-199", 1000), { start: 100, end: 199 });
  assert.deepEqual(c.parseRange("bytes=-500", 1000), { start: 500, end: 999 });
  assert.deepEqual(c.parseRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  assert.equal(c.parseRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(c.parseRange(null, 1000), null);
  assert.equal(c.parseRange("items=1-2", 1000), null);
});
