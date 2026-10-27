import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

/* The stock estimate, read from the real module the Admin page and the Work board both use. */
const src = fs.readFileSync(new URL("../src/lib/stockmath.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stock-")), "stockmath.mjs");
fs.writeFileSync(out, js);
const { stockOutlook } = await import(`file://${out}`);

test("what is left falls by the monthly use since the count", () => {
  const o = stockOutlook({ qty: 304, reorder_at: 50, per_month: 304, counted_at: "2026-10-01" }, "2026-10-16");
  assert.equal(o.left, 154);
  assert.equal(o.low, false);
  assert.equal(o.runs_out, "2026-10-31");
});

test("the reorder date is when the estimate reaches the reorder level", () => {
  const o = stockOutlook({ qty: 200, reorder_at: 50, per_month: 152, counted_at: "2026-10-01" }, "2026-10-01");
  assert.equal(o.reorder_by, "2026-10-31");
});

test("past the reorder level it is flagged, and never goes below zero", () => {
  const o = stockOutlook({ qty: 10, reorder_at: 20, per_month: 30.4, counted_at: "2026-09-01" }, "2026-10-23");
  assert.equal(o.left, 0);
  assert.equal(o.low, true);
});

test("with no monthly use the count stands as counted", () => {
  const o = stockOutlook({ qty: 40, reorder_at: 10, per_month: 0, counted_at: "2026-10-01" }, "2026-10-20");
  assert.equal(o.left, 40);
  assert.equal(o.runs_out, null);
});

test("a count over a month old is stale", () => {
  assert.equal(stockOutlook({ qty: 1, reorder_at: 0, counted_at: "2026-08-01" }, "2026-10-01").stale, true);
  assert.equal(stockOutlook({ qty: 1, reorder_at: 0, counted_at: "2026-09-20" }, "2026-10-01").stale, false);
});
