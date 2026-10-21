import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* No code may decide anything by comparing a role to a literal string.

   This is here because of a real failure, and a quiet one. The publish gate — the single thing
   standing between a draft and a public post that cannot be deleted — asked
   `SELECT count(*) FROM users WHERE role = 'admin'`, and when nobody matched it opened. Two
   separate changes broke it without anyone noticing: accounts moved to their own database, and
   then the roles were renamed. It kept working only because a stale copy of the old table was
   still sitting in the brand database saying 'admin'. Clear that copy and the gate opens for
   everything.

   A literal role name in a comparison is how that happens. Capabilities are the question worth
   asking — can this person approve — and they survive a rename, because the rename is one table
   in roles.ts rather than a string in forty files. */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/* Blanks comments while keeping every newline, so reported line numbers still point at the
   real line. Good enough for this: it is not a parser, and a role name inside a string literal
   is something we want to see anyway. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
});

/* The file that defines the roles is allowed to name them; so is the one that renders the
   picker, and the migration that renamed the stored values. */
const ALLOWED = ["lib/roles.ts", "lib/auth.ts", "lib/migrate.ts", "lib/db.ts"];

/* A role name used as a value in a comparison or a SQL filter. Assigning one — `role: "owner"`
   when creating the first account — is not a decision and is fine. */
const PATTERNS = [
  /role\s*[=!]==?\s*["'`](owner|manager|creator|approver|viewer|admin|marketing)["'`]/,
  /["'`](owner|manager|creator|approver|viewer|admin|marketing)["'`]\s*[=!]==?\s*\w*[Rr]ole/,
  /role\s*=\s*'(owner|manager|creator|approver|viewer|admin|marketing)'/,  // inside SQL
];

test("nothing decides access by comparing a role to a literal", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (ALLOWED.some((a) => rel === a)) continue;
    /* Comments are blanked before scanning rather than skipped line by line. This file's own
       explanation of the bug contains the exact SQL that caused it, several lines into a block
       comment whose continuation lines carry no marker — which the first version of this test
       reported as a breach of itself. */
    const code = stripComments(fs.readFileSync(file, "utf8"));
    code.split("\n").forEach((line, i) => {
      for (const re of PATTERNS) {
        if (re.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `ask what the person can do instead — can(user, "approve"):\n  ${offenders.join("\n  ")}`);
});

test("the check can see a breach", () => {
  const sample = `const admins = db.prepare("SELECT count(*) FROM users WHERE role = 'admin'").get();`;
  assert.ok(PATTERNS.some((re) => re.test(sample)), "the SQL form that actually broke must be caught");
  assert.ok(PATTERNS.some((re) => re.test('if (user.role === "owner") {')), "the comparison form must be caught");
  assert.ok(!PATTERNS.some((re) => re.test('createUser({ role: "owner", name })')), "assigning a role is not a decision");
});
