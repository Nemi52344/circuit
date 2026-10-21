import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* A client component must not reach a module that opens the database.

   This is not a style rule. Importing one of these from a "use client" file pulls
   better-sqlite3 — or next/headers — into the browser bundle, and the page returns a 500 that
   the TypeScript compiler cannot see, because nothing about the types is wrong. It has happened
   twice: once for one string of Meta scopes, once for an array of weekday names. Both times the
   fix was to move the constant into a module that imports nothing.

   So the rule is checked here instead of remembered. */

/* fileURLToPath, not .pathname: this project lives in a directory with a space and an
   ampersand in its name, and .pathname hands back the percent-encoded form. */
const SRC = fileURLToPath(new URL("../src/", import.meta.url));

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
});

/* Modules that touch the database, the filesystem or the request. Anything importing one of
   these transitively is server-only. */
const SERVER_ROOTS = ["db", "auth", "migrate"];

/* Which of our own modules each file really imports at runtime.

   `import type { Task } from "@/lib/books"` is erased by the compiler and pulls in nothing, so
   it does not count — several pages legitimately take a type from a module that opens the
   database. A mixed `import { can, type Role }` does load the module, and does count. */
const importsOf = (file) => fs.readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => !/^\s*import\s+type\b/.test(line))
  .flatMap((line) => [...line.matchAll(/from\s+"@\/lib\/([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));

const libFile = (name) => {
  for (const ext of [".ts", ".tsx"]) {
    const p = path.join(SRC, "lib", name + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

/* Follow the chain: a client file importing a module that imports db is just as broken. */
function serverOnly(name, seen = new Set()) {
  if (SERVER_ROOTS.includes(name)) return name;
  if (seen.has(name)) return null;
  seen.add(name);
  const f = libFile(name);
  if (!f) return null;
  if (/from\s+"(node:)?(fs|path|crypto|child_process)"|from\s+"next\/headers"|from\s+"better-sqlite3"/.test(fs.readFileSync(f, "utf8"))) return name;
  for (const dep of importsOf(f)) {
    const hit = serverOnly(dep, seen);
    if (hit) return `${name} → ${hit}`;
  }
  return null;
}

test("no client component pulls the database into the browser", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    if (!/^["']use client["']/m.test(text)) continue;
    for (const dep of importsOf(file)) {
      const chain = serverOnly(dep);
      if (chain) offenders.push(`${path.relative(SRC, file)} imports @/lib/${chain}`);
    }
  }
  assert.deepEqual(offenders, [], `move the shared value into a module that imports nothing:\n  ${offenders.join("\n  ")}`);
});

test("a type-only import is not a breach, because nothing is loaded", () => {
  // several pages take a type from a module that opens the database; that is fine
  assert.ok(!importsOf(path.join(SRC, "app/admin/page.tsx")).includes("books"));
});

test("the check can actually see a breach", () => {
  // roles.ts and dates.ts are the import-free modules client code is meant to use
  assert.equal(serverOnly("roles"), null);
  assert.equal(serverOnly("dates"), null);
  // and these are the ones it must not
  assert.ok(serverOnly("db"));
  assert.ok(serverOnly("auth"));
  assert.ok(serverOnly("series"), "series reaches the database through db");
});
