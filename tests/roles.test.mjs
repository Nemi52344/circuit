import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

/* The permission table, tested against the real one.

   This is the module that decides whether a viewer can publish, so the test imports it rather
   than restating its rules — a second copy of a permission matrix is right until the day
   somebody changes one of them. roles.ts has no imports precisely so this is possible. */
const src = fs.readFileSync(new URL("../src/lib/roles.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "roles-")), "roles.mjs");
fs.writeFileSync(out, js);
const { can, asRole, isRole, grantsOf, ROLES } = await import(`file://${out}`);

const as = (role) => ({ role });

test("an approver signs work off and cannot make any of it", () => {
  assert.equal(can(as("approver"), "approve"), true);
  assert.equal(can(as("approver"), "create"), false);
});

test("a creator makes work and cannot sign it off", () => {
  assert.equal(can(as("creator"), "create"), true);
  assert.equal(can(as("creator"), "approve"), false);
});

test("nobody but the owner hands out accounts", () => {
  for (const { role } of ROLES) assert.equal(can(as(role), "people"), role === "owner", role);
});

test("salaries, opex and the P&L are the Admin's alone", () => {
  for (const { role } of ROLES) assert.equal(can(as(role), "finance"), role === "owner", role);
});

test("a Marketing Manager runs the marketing but not the books or the accounts", () => {
  for (const what of ["view", "create", "approve", "manage"]) assert.equal(can(as("manager"), what), true, what);
  for (const what of ["finance", "people"]) assert.equal(can(as("manager"), what), false, what);
});

test("a Marketing Executive makes work and cannot run, sign off or see the books", () => {
  for (const what of ["approve", "manage", "finance", "people"]) assert.equal(can(as("creator"), what), false, what);
});

test("a viewer changes nothing", () => {
  assert.deepEqual(grantsOf("viewer"), ["view"]);
  for (const what of ["create", "approve", "manage", "finance", "people"]) assert.equal(can(as("viewer"), what), false, what);
});

test("every role can read, or it could not use the app at all", () => {
  for (const { role } of ROLES) assert.equal(can(as(role), "view"), true, role);
});

test("no role is left out of the table", () => {
  for (const { role } of ROLES) assert.ok(grantsOf(role).length > 0, role);
  assert.equal(ROLES.length, 5);
});

test("the two old roles keep exactly the access they had", () => {
  assert.equal(asRole("admin"), "owner");
  assert.equal(asRole("marketing"), "creator");
  assert.equal(can(as("admin"), "approve"), true);
  assert.equal(can(as("marketing"), "create"), true);
  assert.equal(can(as("marketing"), "approve"), false);
});

test("anything unrecognised is allowed nothing beyond reading", () => {
  for (const bad of ["superuser", "", "ADMIN", "owner ", "__proto__", "constructor"]) {
    assert.equal(asRole(bad), "viewer", bad);
    assert.equal(can(as(bad), "create"), false, bad);
    assert.equal(can(as(bad), "people"), false, bad);
  }
  assert.equal(isRole("superuser"), false);
  assert.equal(isRole("toString"), false);
});

test("no user at all is allowed nothing", () => {
  for (const nobody of [null, undefined, {}, { role: 7 }, { role: null }]) {
    for (const what of ["view", "create", "approve", "manage", "finance", "people"]) {
      assert.equal(can(nobody, what), false, `${JSON.stringify(nobody)} ${what}`);
    }
  }
});

test("the grants handed out are a copy, so a caller cannot edit the table", () => {
  const g = grantsOf("viewer");
  g.push("people");
  assert.equal(can(as("viewer"), "people"), false);
});
