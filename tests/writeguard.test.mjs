import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* Who may change anything at all.

   Most routes ask handle() for nothing beyond a session, so the only thing standing between a
   Viewer and every POST, PATCH and DELETE in the app is the list in http.ts. A viewer account
   really did create a document and add a competitor through those routes, and both were still
   there afterwards — the role table said "reads everything, changes nothing" and the server
   did not enforce it.

   The list is read out of http.ts rather than restated, and checked against the real
   permission table in roles.ts, so a role added later cannot quietly gain or lose the ability
   to write without this failing. */
const compile = async (rel, name) => {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "writeguard-")), name);
  fs.writeFileSync(out, js);
  return import(pathToFileURL(out).href);
};

const { can, ROLES } = await compile("../src/lib/roles.ts", "roles.mjs");

/* http.ts cannot be imported here — it reaches the database — so the one line that matters is
   read out of it. If the constant is renamed or dropped, this fails rather than passing on a
   stale copy of the rule. */
const http = fs.readFileSync(new URL("../src/lib/http.ts", import.meta.url), "utf8");
const declared = http.match(/const MAY_CHANGE: Can\[\] = \[([^\]]*)\]/);
const MAY_CHANGE = declared ? declared[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : [];

const mayWrite = (role) => MAY_CHANGE.some((c) => can({ role }, c));

test("http.ts still declares which capabilities allow a write", () => {
  assert.ok(declared, "MAY_CHANGE has been renamed or removed from http.ts — the write guard may be gone");
  assert.deepEqual(MAY_CHANGE, ["create", "approve", "manage"]);
});

test("a viewer cannot change anything", () => {
  assert.equal(mayWrite("viewer"), false);
});

test("every other role can", () => {
  for (const { role } of ROLES) {
    if (role === "viewer") continue;
    assert.equal(mayWrite(role), true, `${role} must still be able to write`);
  }
});

test("an approver can write, because signing off is a write", () => {
  /* Approvers hold neither create nor manage. If the guard ever asked for "create" alone,
     sign-off would break and the queue would stop moving with no obvious cause. */
  assert.equal(can({ role: "approver" }, "create"), false);
  assert.equal(mayWrite("approver"), true);
});

test("the guard only covers methods that change things", () => {
  const re = http.match(/const CHANGES = (\/\^\([^/]*\)\$\/i)/);
  assert.ok(re, "CHANGES has been renamed or removed from http.ts");
  const methods = new RegExp(re[1].slice(1, -2), "i");
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.ok(methods.test(m), `${m} must be guarded`);
  for (const m of ["GET", "HEAD", "OPTIONS"]) assert.ok(!methods.test(m), `${m} must stay readable`);
});
