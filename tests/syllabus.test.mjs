import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* The course has to hold together: four levels in order, six lessons each, every check a real
   question with one right answer — a broken key would teach the wrong thing. */
const src = fs.readFileSync(new URL("../src/lib/syllabus.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "syl-")), "syllabus.mjs");
fs.writeFileSync(out, js);
const s = await import(pathToFileURL(out).href);

test("four levels, from basics to advanced, six lessons each", () => {
  assert.deepEqual(s.LEVELS.map((l) => l.key), ["basic", "normal", "hard", "advanced"]);
  for (const l of s.LEVELS) assert.equal(l.lessons.length, 6, l.key);
});

test("lesson ids are unique and their question ids do not collide", () => {
  const ids = s.ALL_LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  const qids = s.ALL_LESSONS.flatMap((l) => l.checks.map((_, i) => s.questionId(l.id, i)));
  assert.equal(new Set(qids).size, qids.length);
  assert.ok(qids.every((q) => q.startsWith("syl-")));
});

test("every lesson is short and complete, every check has four options and one key", () => {
  for (const l of s.ALL_LESSONS) {
    assert.ok(l.minutes >= 3 && l.minutes <= 5, `${l.id} minutes`);
    assert.ok(l.short && l.example && l.tryThis, `${l.id} text`);
    assert.ok(l.points.length >= 3 && l.points.length <= 6, `${l.id} points`);
    assert.ok(l.terms.length >= 2, `${l.id} terms`);
    assert.equal(l.checks.length, 3, `${l.id} checks`);
    for (const [q, opts, a, why] of l.checks) {
      assert.equal(opts.length, 4, q);
      assert.equal(new Set(opts).size, 4, `${q} has a repeated option`);
      assert.ok(Number.isInteger(a) && a >= 0 && a < 4, q);
      assert.ok(why.length > 10, q);
    }
  }
  assert.ok(s.LESSON_PASS <= 3);
});
