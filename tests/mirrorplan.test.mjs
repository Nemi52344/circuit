import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* What goes to the online copy and what is held back, read from the real module. */
const src = fs.readFileSync(new URL("../src/lib/mirrorplan.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mirror-")), "mirrorplan.mjs");
fs.writeFileSync(out, js);
const m = await import(pathToFileURL(out).href);

test("sign-ins, password copies and finance stay on the Mac unless finance is allowed", () => {
  const all = ["posts", "sessions", "users", "mirror_rows", "people", "bills", "pnl", "settings", "sqlite_sequence"];
  assert.deepEqual(m.tablesToMirror(all, false), ["posts", "settings"]);
  assert.deepEqual(m.tablesToMirror(all, true), ["posts", "people", "bills", "pnl", "settings"]);
});

test("API keys and tokens in settings are never sent, nor the ticking clock", () => {
  for (const key of ["meta_token", "sb_key", "gemini_key", "hf_key_secret", "mail_hook", "meta_app_secret", "turso_token", "worker_last_tick", "turso_last"]) {
    assert.equal(m.keepRow("settings", { key, value: "x" }), false, key);
  }
  for (const key of ["brand", "mail_to", "sb_url", "turso_url", "ig_user_id"]) assert.equal(m.keepRow("settings", { key, value: "x" }), true, key);
  assert.equal(m.keepRow("posts", { key: "meta_token" }), true);
});

test("only changed rows are sent, and rows gone here are removed there", () => {
  const sent = new Map([["a", "1"], ["b", "2"], ["c", "3"]]);
  const plan = m.planPush([{ key: "a", hash: "1" }, { key: "b", hash: "9" }, { key: "d", hash: "4" }], sent);
  assert.deepEqual(plan.upsert, ["b", "d"]);
  assert.deepEqual(plan.remove, ["c"]);
  assert.deepEqual(m.planPush([{ key: "a", hash: "1" }], new Map([["a", "1"]])), { upsert: [], remove: [] });
});

test("values survive the trip through Turso's HTTP spelling", () => {
  const bytes = Buffer.from([0, 1, 2, 250]);
  for (const v of [null, 42, -7, 3.5, "text", 9007199254740993n]) {
    assert.deepEqual(m.fromValue(m.toValue(v)), v);
  }
  assert.deepEqual(m.toValue(42), { type: "integer", value: "42" });
  assert.deepEqual(Buffer.from(m.fromValue(m.toValue(bytes))), bytes);
});

test("a two-column key is one key, and a PDF hashes by its bytes", () => {
  assert.equal(m.rowKey(["post_id", "file_id"], { post_id: "p", file_id: "f", position: 1 }), '["p","f"]');
  assert.notEqual(m.rowText(["b"], { b: Buffer.from("one") }), m.rowText(["b"], { b: Buffer.from("two") }));
});

test("create statements are made safe to repeat, and addresses are made HTTP", () => {
  assert.equal(m.ifMissing("CREATE TABLE posts (id TEXT)"), "CREATE TABLE IF NOT EXISTS posts (id TEXT)");
  assert.equal(m.ifMissing("CREATE UNIQUE INDEX ix ON t(a)"), "CREATE UNIQUE INDEX IF NOT EXISTS ix ON t(a)");
  assert.equal(m.ifMissing("CREATE TABLE IF NOT EXISTS x (a)"), "CREATE TABLE IF NOT EXISTS x (a)");
  assert.equal(m.httpUrl("libsql://circuit-bnc-org.turso.io"), "https://circuit-bnc-org.turso.io");
  assert.equal(m.httpUrl("http://127.0.0.1:8080/"), "http://127.0.0.1:8080");
});

test("batches stay under the size and count limits", () => {
  const sizes = [700, 700, 700, 10, 10];
  const b = m.batches(sizes, (n) => n, 1500, 3);
  assert.deepEqual(b, [[700, 700], [700, 10, 10]]);
  assert.equal(m.batches(Array(450).fill(1), () => 1).length, 3);
});

test("an approver's sign-off link never goes online", () => {
  const row = { id: "a1", token: "secret-link", status: "pending" };
  assert.deepEqual(m.maskRow("approvals", row), { id: "a1", token: m.HIDDEN, status: "pending" });
  assert.equal(row.token, "secret-link");
  assert.deepEqual(m.maskRow("posts", { token: "x" }), { token: "x" });
});

test("every table Circuit creates is explained in the guide", () => {
  const src = ["db.ts", "migrate.ts"].map((f) => fs.readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8")).join("\n");
  const accountsOnly = new Set(["brands", "account_settings"]);
  const tables = [...new Set([...src.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)\s*\(/g)].map((x) => x[1]))]
    .filter((t) => !m.LOCAL_ONLY.has(t) && !accountsOnly.has(t));
  const missing = tables.filter((t) => !m.GUIDE[t]);
  assert.deepEqual(missing, [], `add these to GUIDE in mirrorplan.ts: ${missing.join(", ")}`);
});

test("the guide says plainly which tables are online and which stay on the Mac", () => {
  const rows = m.guideRows(["posts", "people", "sessions", "settings"], ["posts", "settings"]);
  assert.equal(rows[0].table_name, m.GUIDE_TABLE);
  assert.equal(rows.find((r) => r.table_name === "people").online, "no — kept on the Mac (Admin's choice)");
  assert.equal(rows.find((r) => r.table_name === "posts").online, "yes");
  assert.equal(rows.some((r) => r.table_name === "sessions"), false);
});

test("the shared accounts travel under their own names, without sessions or recovery codes", () => {
  assert.deepEqual(m.ACCOUNT_TABLES, { users: "accounts_users", brands: "accounts_brands", account_settings: "accounts_settings" });
  assert.equal("sessions" in m.ACCOUNT_TABLES, false);
  assert.match(m.renameCreate("CREATE TABLE users (\n id TEXT PRIMARY KEY)", "users", "accounts_users"), /^CREATE TABLE "accounts_users" \(/);
  assert.match(m.renameCreate("CREATE TABLE IF NOT EXISTS \"brands\" (x)", "brands", "accounts_brands"), /^CREATE TABLE IF NOT EXISTS "accounts_brands" \(/);
  for (const key of ["recovery_hash", "recovery_user", "recovery_until", "smtp_password"]) assert.equal(m.keepRow("accounts_settings", { key }), false, key);
  assert.equal(m.keepRow("accounts_settings", { key: "brand_active" }), true);
});

test("file bytes are read only when sent, and the copy goes every minute with an hourly count", () => {
  assert.equal(m.LAZY_BLOB.file_chunks, "data");
  assert.equal(m.SEND_EVERY_MS, 60_000);
  assert.ok(m.COUNT_EVERY_MS >= 60 * 60_000);
  assert.equal(m.keepRow("settings", { key: "turso_counted_at" }), false);
});
