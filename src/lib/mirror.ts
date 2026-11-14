import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDb, getAccountsDb, getSetting, setSetting, now, DATA_DIR, currentBrand, DEFAULT_BRAND_SLUG } from "@/lib/db";
import {
  tablesToMirror, keepRow, maskRow, rowKey, rowText, planPush, toValue, fromValue, ifMissing, quote, batches, httpUrl,
  guideRows, GUIDE_TABLE, LAZY_BLOB, ACCOUNT_TABLES, SEND_EVERY_MS, COUNT_EVERY_MS, renameCreate, type Value,
} from "@/lib/mirrorplan";

/* The online copy, in Turso.

   Circuit keeps working on the database on this computer — nothing about how a page reads or writes
   changes, and nothing waits on the internet. Every minute the rows that changed since the last
   push are sent to a Turso database, one per brand, and rows deleted here are deleted there:
   every table, every file (the bytes are rows in file_chunks), and — from the BNC push — the
   shared accounts as accounts_* tables. So the copy online is a minute behind, never ahead,
   and if this computer is lost the data is not.

   Why not run on Turso's own driver and let it sync: it was tried on a copy of the real data.
   It crashes the process when loaded beside the driver the tests use, it adds a field to every
   row that would have leaked into every API response, and in its default mode every write
   waits on the network. Pushing changes from the side keeps all of that out of the app.

   What stays here: sign-in sessions, API keys, and — until the Admin says otherwise — the
   finance tables (see mirrorplan.ts). */

export type MirrorRun = { at: string; ok: boolean; sent: number; deleted: number; tables: number; seconds: number; error?: string; rebuilt?: string[] };
export type MirrorCheck = { at: string; ok: boolean; tables: number; rows: number; differences: string[] };

export function mirrorSettings() {
  const url = getSetting("turso_url") || "";
  const token = getSetting("turso_token") || "";
  let last: MirrorRun | null = null;
  let check: MirrorCheck | null = null;
  try { last = JSON.parse(getSetting("turso_last") || "null"); } catch { /* unreadable is the same as none */ }
  try { check = JSON.parse(getSetting("turso_check") || "null"); } catch { /* likewise */ }
  return {
    url,
    has_token: Boolean(token),
    ready: Boolean(url && token),
    finance: getSetting("turso_finance") === "1",
    last,
    check,
  };
}

export function mirrorDue(): boolean {
  const s = mirrorSettings();
  if (!s.ready) return false;
  return !s.last || Date.now() - new Date(s.last.at).getTime() > SEND_EVERY_MS;
}

/* ---- talking to Turso ---- */

type Stmt = { sql: string; args?: Value[] };
type Result = { cols: { name: string }[]; rows: Value[][]; affected_row_count: number };

async function pipeline(stmts: Stmt[], url = getSetting("turso_url") || "", token = getSetting("turso_token") || ""): Promise<Result[]> {
  const base = httpUrl(url);
  if (!base || !token) throw new Error("The online copy isn't set up — add the Turso address and token in Settings");
  const res = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [...stmts.map((stmt) => ({ type: "execute", stmt })), { type: "close" }] }),
    signal: AbortSignal.timeout(60000),
  }).catch((e: Error) => { throw new Error(`Couldn't reach Turso: ${e.message}`); });
  if (res.status === 401 || res.status === 403) throw new Error("Turso refused the token — make a new one and save it again");
  if (!res.ok) throw new Error(`Turso answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { results: { type: string; response?: { result?: Result }; error?: { message: string } }[] };
  const out: Result[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const r = body.results[i];
    if (!r || r.type !== "ok") throw new Error(`Turso: ${r?.error?.message || "no answer"} (in ${stmts[i].sql.slice(0, 60)}…)`);
    out.push(r.response?.result || { cols: [], rows: [], affected_row_count: 0 });
  }
  return out;
}

const rowsOf = (r: Result): Record<string, unknown>[] =>
  r.rows.map((vals) => Object.fromEntries(r.cols.map((c, i) => [c.name, fromValue(vals[i])])));

/* ---- what this brand has ---- */

/* A table to send: its name online, and where it is read from here — the brand's database,
   or for the accounts tables the shared accounts database under its own name. */
type Table = { name: string; local: string; db: Database.Database; sql: string; cols: string[]; pk: string[] };

function describe(db: Database.Database, local: string, name: string, sql: string): Table {
  const info = db.prepare(`PRAGMA table_info(${quote(local)})`).all() as { name: string; pk: number }[];
  const pk = info.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  return { name, local, db, sql: local === name ? sql : renameCreate(sql, local, name), cols: info.map((c) => c.name), pk: pk.length ? pk : ["rowid"] };
}

function localTables(db: Database.Database): Table[] {
  const all = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL ORDER BY name").all() as { name: string; sql: string }[];
  const keep = new Set(tablesToMirror(all.map((t) => t.name), getSetting("turso_finance") === "1"));
  const own = all.filter((t) => keep.has(t.name)).map((t) => describe(db, t.name, t.name, t.sql));
  /* The accounts are shared by every brand, so they travel once, with BNC's copy. */
  if (currentBrand().slug !== DEFAULT_BRAND_SLUG) return own;
  const acc = getAccountsDb();
  const accAll = acc.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL").all() as { name: string; sql: string }[];
  return [...own, ...accAll.filter((t) => ACCOUNT_TABLES[t.name]).map((t) => describe(acc, t.name, ACCOUNT_TABLES[t.name], t.sql))];
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

/* Every row of a table as it is now, keyed and fingerprinted. A table with a lazy blob is read
   without it: its own fingerprint column stands for the bytes, which are fetched only for the
   rows actually being sent. `from` reads a restored copy, where every table has its online name. */
function snapshot(t: Table, from?: Database.Database) {
  const db = from || t.db;
  const source = from ? t.name : t.local;
  const lazy = LAZY_BLOB[t.name];
  const cols = lazy ? t.cols.filter((c) => c !== lazy) : t.cols;
  const list0 = lazy ? cols.map(quote).join(", ") : "*";
  const select = t.pk[0] === "rowid" ? `SELECT rowid, ${list0} FROM ${quote(source)}` : `SELECT ${list0} FROM ${quote(source)}`;
  const rows = (db.prepare(select).all() as Record<string, unknown>[]).filter((r) => keepRow(t.name, r)).map((r) => maskRow(t.name, r));
  const byKey = new Map<string, Record<string, unknown>>();
  const list = rows.map((r) => { const key = rowKey(t.pk, r); byKey.set(key, r); return { key, hash: hash(rowText(cols, r)) }; });
  return { list, byKey };
}

/* The bytes of one lazy row, read when it is about to be sent. */
function lazyValue(t: Table, row: Record<string, unknown>): unknown {
  const col = LAZY_BLOB[t.name];
  const r = t.db.prepare(`SELECT ${quote(col)} AS v FROM ${quote(t.local)} WHERE ${t.pk.map((c) => `${quote(c)} = ?`).join(" AND ")}`)
    .get(...t.pk.map((c) => row[c])) as { v: unknown } | undefined;
  return r?.v ?? null;
}

function sentHashes(db: Database.Database, table: string): Map<string, string> {
  const rows = db.prepare("SELECT k, h FROM mirror_rows WHERE tbl = ?").all(table) as { k: string; h: string }[];
  return new Map(rows.map((r) => [r.k, r.h]));
}

/* ---- the push ---- */

let pushing = false;

export async function pushMirror(): Promise<MirrorRun> {
  if (pushing) throw new Error("A push is already running");
  pushing = true;
  const started = Date.now();
  const db = getDb();
  let sent = 0, deleted = 0;
  const rebuilt: string[] = [];
  try {
    const tables = localTables(db);

    /* The shape first. A table missing online is made; one whose columns no longer match —
       a migration added one here — is rebuilt from scratch and sent whole, which for tables
       this size is quicker than working out an ALTER that Turso would accept.

       And the count: if Turso holds a different number of rows from the number recorded here
       as sent — the online database was emptied or replaced, or someone edited it by hand —
       the table is cleared there and sent again whole. The copy heals itself rather than
       trusting a record that has stopped being true. */
    const [master] = await pipeline([{ sql: "SELECT name FROM sqlite_master WHERE type = 'table'" }]);
    const existing = new Set(rowsOf(master).map((r) => String(r.name)));
    const online = tables.filter((t) => existing.has(t.name));
    const counted = getSetting("turso_counted_at");
    const count = !counted || Date.now() - new Date(counted).getTime() > COUNT_EVERY_MS;
    const probe = await pipeline(online.flatMap((t) => [
      { sql: `SELECT name FROM pragma_table_info('${t.name.replace(/'/g, "''")}')` },
      { sql: count ? `SELECT COUNT(*) AS n FROM ${quote(t.name)}` : "SELECT -1 AS n" },
    ]));
    const sentCount = db.prepare("SELECT COUNT(*) AS n FROM mirror_rows WHERE tbl = ?");
    const forgetTable = db.prepare("DELETE FROM mirror_rows WHERE tbl = ?");
    const shape: Stmt[] = [];
    for (const t of tables) {
      const i = online.indexOf(t);
      if (i < 0) {
        shape.push({ sql: ifMissing(t.sql) });
        forgetTable.run(t.name);
        continue;
      }
      const cols = rowsOf(probe[i * 2]).map((r) => String(r.name));
      const there = Number(rowsOf(probe[i * 2 + 1])[0]?.n ?? 0);
      if (cols.join(",") !== t.cols.join(",")) {
        shape.push({ sql: `DROP TABLE IF EXISTS ${quote(t.name)}` }, { sql: t.sql });
        forgetTable.run(t.name);
        rebuilt.push(t.name);
      } else if (count && there !== (sentCount.get(t.name) as { n: number }).n) {
        shape.push({ sql: `DELETE FROM ${quote(t.name)}` });
        forgetTable.run(t.name);
        if (there) rebuilt.push(t.name);
      }
    }
    const indexes = (db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as { tbl_name: string; sql: string }[])
      .filter((ix) => tables.some((t) => t.name === ix.tbl_name && t.db === db));
    await pipeline([...shape, ...indexes.map((ix) => ({ sql: ifMissing(ix.sql) }))]);

    /* Then the rows that changed, a batch at a time. A batch is written down here as sent only
       once Turso has answered every statement in it — so a push cut off halfway resends from
       where it stopped, and never marks a row sent that is not there. Turso runs the rest of a
       pipeline after one statement fails, so a failed batch can be half applied there; that is
       harmless, because every statement is a replace-by-key or delete-by-key and the resend
       lands on the same rows. */
    const record = db.prepare("INSERT INTO mirror_rows (tbl, k, h) VALUES (?, ?, ?) ON CONFLICT(tbl, k) DO UPDATE SET h = excluded.h");
    const forget = db.prepare("DELETE FROM mirror_rows WHERE tbl = ? AND k = ?");
    for (const t of tables) {
      const { list, byKey } = snapshot(t);
      const hashes = new Map(list.map((r) => [r.key, r.hash]));
      const { upsert, remove } = planPush(list, sentHashes(db, t.name));
      if (!upsert.length && !remove.length) continue;

      const cols = t.pk[0] === "rowid" ? ["rowid", ...t.cols] : t.cols;
      const insert = `INSERT OR REPLACE INTO ${quote(t.name)} (${cols.map(quote).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      const del = `DELETE FROM ${quote(t.name)} WHERE ${t.pk.map((c) => `${quote(c)} = ?`).join(" AND ")}`;
      const lazy = LAZY_BLOB[t.name];
      /* A statement is built only when its batch is about to go, so a lazy row's bytes are in
         memory for one batch at a time; its size is estimated from the row until then. */
      type Op = { key: string; gone: boolean; size: number; make: () => Stmt };
      const ops: Op[] = [
        ...upsert.map((key) => {
          const row = byKey.get(key)!;
          const make = () => ({ sql: insert, args: cols.map((c) => toValue(c === lazy ? lazyValue(t, row) : row[c])) });
          return { key, gone: false, make, size: lazy ? Math.ceil(Number(row.size || 0) * 1.4) + 400 : JSON.stringify(make()).length };
        }),
        ...remove.map((key) => {
          const make = () => ({ sql: del, args: (JSON.parse(key) as unknown[]).map(toValue) });
          return { key, gone: true, make, size: JSON.stringify(make()).length };
        }),
      ];
      for (const batch of batches(ops, (o) => o.size)) {
        await pipeline([{ sql: "BEGIN" }, ...batch.map((o) => o.make()), { sql: "COMMIT" }]);
        db.transaction(() => {
          for (const o of batch) {
            if (o.gone) { forget.run(t.name, o.key); deleted++; } else { record.run(t.name, o.key, hashes.get(o.key)!); sent++; }
          }
        })();
      }
    }

    /* A table that should not be online — finance switched back off, or a table dropped here —
       is dropped there too, empty or not, and its bookkeeping cleared so switching back on
       sends everything again. Turso's own tables are left alone. */
    const kept = new Set(tables.map((t) => t.name));
    const stale = [...existing].filter((n) => !kept.has(n) && n !== GUIDE_TABLE && !/^(sqlite_|libsql_|_litestream)/.test(n));
    if (stale.length) await pipeline(stale.map((n) => ({ sql: `DROP TABLE IF EXISTS ${quote(n)}` })));
    for (const r of db.prepare("SELECT DISTINCT tbl FROM mirror_rows").all() as { tbl: string }[]) {
      if (!kept.has(r.tbl)) db.prepare("DELETE FROM mirror_rows WHERE tbl = ?").run(r.tbl);
    }

    if (count) setSetting("turso_counted_at", now());
    await sendGuide(db, tables.map((t) => t.name), existing.has(GUIDE_TABLE));

    const run: MirrorRun = { at: now(), ok: true, sent, deleted, tables: tables.length, seconds: secs(started), ...(rebuilt.length ? { rebuilt } : {}) };
    setSetting("turso_last", JSON.stringify(run));
    return run;
  } catch (e) {
    const run: MirrorRun = { at: now(), ok: false, sent, deleted, tables: 0, seconds: secs(started), error: (e as Error).message };
    setSetting("turso_last", JSON.stringify(run));
    throw e;
  } finally {
    pushing = false;
  }
}

/* The plain-words guide to the copy (mirrorplan.ts), rewritten whenever what it says changes —
   a new table, or finance switched on or off — and otherwise left alone. */
async function sendGuide(db: Database.Database, mirrored: string[], present: boolean) {
  const local = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  const rows = guideRows([...local, ...mirrored.filter((n) => n.startsWith("accounts_"))], mirrored);
  const h = hash(JSON.stringify(rows));
  if (present && getSetting("turso_guide") === h) return;
  const cols = ["table_name", "section", "what_it_holds", "one_row_is", "online"] as const;
  await pipeline([
    { sql: "BEGIN" },
    { sql: `DROP TABLE IF EXISTS ${quote(GUIDE_TABLE)}` },
    { sql: `CREATE TABLE ${quote(GUIDE_TABLE)} (table_name TEXT PRIMARY KEY, section TEXT, what_it_holds TEXT, one_row_is TEXT, online TEXT)` },
    ...rows.map((r) => ({ sql: `INSERT INTO ${quote(GUIDE_TABLE)} (${cols.join(", ")}) VALUES (?, ?, ?, ?, ?)`, args: cols.map((c) => toValue(r[c])) })),
    { sql: "COMMIT" },
  ]);
  setSetting("turso_guide", h);
}

const secs = (from: number) => Math.round((Date.now() - from) / 100) / 10;

/* ---- getting it back ---- */

/* Builds a working database file from the online copy alone: every table and index as Turso
   has it, and every row. This is what you would do if this computer were lost — and it is also how
   the copy is checked, because a backup nobody has restored is a hope, not a backup. */
export async function restoreToFile(file: string, url?: string, token?: string, opts: { skipBlobs?: boolean } = {}): Promise<{ tables: number; rows: number }> {
  const [schema] = await pipeline([{ sql: "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC" }], url, token);
  const objs = rowsOf(schema) as { type: string; name: string; sql: string }[];
  const tables = objs.filter((o) => o.type === "table");
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  const out = new Database(file);
  let rows = 0;
  try {
    for (const t of tables) out.exec(t.sql);
    /* Read a page at a time: a table of file chunks is half a gigabyte, far more than one
       answer can carry. When the copy is only being compared, the bytes are left out — each
       chunk's fingerprint is what the comparison reads. */
    for (const t of tables) {
      const lazy = LAZY_BLOB[t.name];
      const page = lazy && !opts.skipBlobs ? 4 : 500;
      let what = "*";
      if (lazy && opts.skipBlobs) {
        const [info] = await pipeline([{ sql: `SELECT name FROM pragma_table_info('${t.name.replace(/'/g, "''")}')` }], url, token);
        what = rowsOf(info).map((c) => String(c.name)).map((c) => (c === lazy ? `NULL AS ${quote(c)}` : quote(c))).join(", ");
      }
      for (let offset = 0; ; offset += page) {
        const [r] = await pipeline([{ sql: `SELECT ${what} FROM ${quote(t.name)} ORDER BY rowid LIMIT ${page} OFFSET ${offset}` }], url, token);
        const list = rowsOf(r);
        if (!list.length) break;
        const cols = r.cols.map((c) => c.name);
        const ins = out.prepare(`INSERT INTO ${quote(t.name)} (${cols.map(quote).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
        out.transaction(() => { for (const row of list) ins.run(...cols.map((c) => row[c])); })();
        rows += list.length;
        if (list.length < page) break;
      }
    }
    for (const ix of objs.filter((o) => o.type === "index")) out.exec(ifMissing(ix.sql));
  } finally {
    out.close();
  }
  return { tables: tables.length, rows };
}

/* Restores the online copy into a scratch file and compares it, row for row, with what is
   here. The scratch file is deleted afterwards; nothing here is touched. */
export async function checkMirror(): Promise<MirrorCheck> {
  const dir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `turso-check-${currentBrand().slug}.db`);
  const differences: string[] = [];
  let rows = 0;
  const db = getDb();
  const tables = localTables(db);
  try {
    await restoreToFile(file, undefined, undefined, { skipBlobs: true });
    const copy = new Database(file, { readonly: true });
    try {
      for (const t of tables) {
        const here = snapshot(t).list;
        let there: { key: string; hash: string }[] = [];
        try { there = snapshot(t, copy).list; } catch { differences.push(`${t.name}: not in the online copy`); continue; }
        rows += here.length;
        const theirs = new Map(there.map((r) => [r.key, r.hash]));
        const missing = here.filter((r) => !theirs.has(r.key)).length;
        const changed = here.filter((r) => theirs.has(r.key) && theirs.get(r.key) !== r.hash).length;
        const extra = there.length - (here.length - missing);
        if (missing || changed || extra) differences.push(`${t.name}: ${[missing && `${missing} missing`, changed && `${changed} out of date`, extra && `${extra} extra`].filter(Boolean).join(", ")}`);
      }
    } finally {
      copy.close();
    }
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  }
  const result: MirrorCheck = { at: now(), ok: !differences.length, tables: tables.length, rows, differences };
  setSetting("turso_check", JSON.stringify(result));
  return result;
}
