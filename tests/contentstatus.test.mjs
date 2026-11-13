import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* Which column a piece of content sits in, read from the real module the board uses. */
const src = fs.readFileSync(new URL("../src/lib/contentstatus.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cstat-")), "contentstatus.mjs");
fs.writeFileSync(out, js);
const c = await import(pathToFileURL(out).href);
const T = "2026-10-28";
const post = (o) => ({ status: "scheduled", scheduled_at: "2026-11-02T18:00", is_video: false, signoff: null, approvers: true, ...o });

test("a poster waits for sign-off; a video does not", () => {
  assert.equal(c.postVerdict(post({}), T).column, "signoff");
  assert.equal(c.postVerdict(post({ is_video: true }), T).column, "scheduled");
  assert.match(c.postVerdict(post({ is_video: true }), T).line, /no sign-off/);
});

test("approved posters are scheduled; sent back and edited-after-approval stay for the manager", () => {
  assert.equal(c.postVerdict(post({ signoff: "approved" }), T).column, "scheduled");
  assert.equal(c.postVerdict(post({ signoff: "rejected" }), T).flag, "sent_back");
  assert.equal(c.postVerdict(post({ signoff: "stale" }), T).flag, "stale");
});

test("with nobody who can approve, nothing waits for sign-off", () => {
  assert.equal(c.postVerdict(post({ approvers: false }), T).column, "scheduled");
});

test("due today and late are flagged; posted is posted", () => {
  assert.equal(c.postVerdict(post({ is_video: true, scheduled_at: "2026-10-28T18:00" }), T).flag, "due");
  assert.equal(c.postVerdict(post({ is_video: true, scheduled_at: "2026-10-20T18:00" }), T).flag, "late");
  assert.equal(c.postVerdict(post({ status: "posted" }), T).column, "posted");
});

test("calendar slots are ideas early and being made later", () => {
  assert.equal(c.slotVerdict({ stage: 1, status: "planned" }).column, "idea");
  assert.equal(c.slotVerdict({ stage: 3, status: "in_progress" }).column, "idea");
  assert.equal(c.slotVerdict({ stage: 5, status: "in_progress" }).column, "making");
  assert.equal(c.slotVerdict({ stage: 8, status: "scheduled" }).column, "making");
});

test("a poster still waiting after its day is flagged as late", () => {
  const v = c.postVerdict(post({ scheduled_at: "2026-10-05T18:00" }), T);
  assert.equal(v.column, "signoff");
  assert.equal(v.flag, "late");
});
