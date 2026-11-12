import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

/* The video edit's arithmetic, read from the real module the studio uses. */
const src = fs.readFileSync(new URL("../src/lib/videoplan.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vplan-")), "videoplan.mjs");
fs.writeFileSync(out, js);
const v = await import(`file://${out}`);

test("cuts are kept inside the footage, in order, merged, and no longer than asked", () => {
  const cuts = v.cleanCuts([{ start: 50, end: 70 }, { start: 5, end: 12 }, { start: 11.9, end: 14 }, { start: 80, end: 200 }, { start: 3, end: 3.5 }], 90, 15);
  assert.deepEqual(cuts, [{ start: 5, end: 14 }, { start: 50, end: 58 }]);
  assert.ok(v.totalLength(cuts) <= 17);
});

test("nothing usable from ChatGPT falls back to the opening seconds", () => {
  assert.deepEqual(v.cleanCuts("nonsense", 90, 15), [{ start: 0, end: 15 }]);
  assert.deepEqual(v.cleanCuts([], 8, 15), [{ start: 0, end: 8 }]);
});

test("captions move onto the reel's timeline and are cut at the edits", () => {
  const lines = [{ start: 4, end: 7, text: "You can ride two thousand kilometres" }, { start: 20, end: 22, text: "Dropped" }, { start: 50, end: 53, text: "Welcome to the hangar" }];
  const r = v.retime(lines, [{ start: 5, end: 14 }, { start: 50, end: 58 }]);
  assert.deepEqual(r, [{ start: 0, end: 2, text: "You can ride two thousand kilometres" }, { start: 9, end: 12, text: "Welcome to the hangar" }]);
});

test("Whisper's [Music] markers are not captions", () => {
  assert.equal(v.isNoise("[Music]"), true);
  assert.equal(v.isNoise("(laughs)"), true);
  assert.equal(v.isNoise("Hello Shubham"), false);
});

test("the ffmpeg graph cuts, joins, crops to 1080x1920, overlays on time, and adds the end card", () => {
  const g = v.filterGraph({ cuts: [{ start: 1, end: 4 }, { start: 9, end: 12 }], hasAudio: true, overlays: [{ file: 1, start: 0, end: 2, x: 0, y: 0 }], endCard: 2, silence: 3 });
  assert.match(g.graph, /\[0:v\]trim=start=1:end=4/);
  assert.match(g.graph, /concat=n=2:v=1:a=1\[cv\]\[ca\]/);
  assert.match(g.graph, /crop=1080:1920/);
  assert.match(g.graph, /overlay=0:0:enable='between\(t,0,2\)'/);
  assert.equal(g.video, "outv");
  assert.equal(g.audio, "outa");
  const silent = v.filterGraph({ cuts: [{ start: 0, end: 5 }], hasAudio: false, overlays: [], endCard: null, silence: null });
  assert.equal(silent.audio, "");
  assert.doesNotMatch(silent.graph, /\[0:a\]/);
});

test("ChatGPT's plan is tidied: short hook, no # in tags, cuts made safe", () => {
  const p = v.cleanPlan({ cuts: [{ start: 2, end: 9 }], hook: "Two thousand kilometres on one electric bike, really", hashtags: ["#EV", "electric bike", "BNC"], cta: "Book your test ride today please now" }, 30, 15);
  assert.equal(p.hook, "Two thousand kilometres on one electric bike,");
  assert.deepEqual(p.hashtags, ["EV", "electricbike", "BNC"]);
  assert.equal(p.cta, "Book your test ride today please");
  assert.deepEqual(p.cuts, [{ start: 2, end: 9 }]);
});

test("ChatGPT's tidied caption lines are kept when sound, and burned-in subtitles switch ours off", () => {
  const p = v.cleanPlan({ burned_in: true, lines: [{ start: 1, end: 3, text: "Your next ride is very good" }, { start: 5, end: 4, text: "backwards" }, { start: 200, end: 210, text: "past the end" }] }, 30, 15);
  assert.equal(p.burned_in, true);
  assert.deepEqual(p.lines, [{ start: 1, end: 3, text: "Your next ride is very good" }]);
  assert.equal(v.cleanPlan({}, 30, 15).burned_in, false);
});
