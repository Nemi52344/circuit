import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* The workstreams, read from the real list the deck and the Learning tests both use. */
const src = fs.readFileSync(new URL("../src/lib/modules.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "modules-")), "modules.mjs");
fs.writeFileSync(out, js);
const { MODULES, automatedShare } = await import(pathToFileURL(out).href);

test("the nineteen whiteboard lines and the image database are there, numbered in order", () => {
  assert.equal(MODULES.length, 20);
  MODULES.forEach((m, i) => assert.equal(m.n, i + 1, m.name));
});

test("every line says what Circuit does and what a person still does", () => {
  for (const m of MODULES) {
    assert.ok(["full", "partial", "manual"].includes(m.auto), m.name);
    assert.ok(m.does.length > 10 && m.person.length > 3, m.name);
    assert.ok(m.page.startsWith("/"), m.name);
  }
});

test("the share counts full as one, partial as half, manual as nothing", () => {
  assert.equal(automatedShare([{ auto: "full" }, { auto: "partial" }, { auto: "manual" }, { auto: "full" }]), 63);
  assert.equal(automatedShare([{ auto: "manual" }]), 0);
});
