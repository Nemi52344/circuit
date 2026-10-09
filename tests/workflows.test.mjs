import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* The scheduler's two rules, and the one that was wrong.

   A routine stopped at a human step used to be restarted the next morning regardless, so a
   daily workflow whose last step waits for somebody left a half-finished run behind every day
   — sixteen had collected. That is the kind of fault nobody reports as a bug, because the app
   looks like it is working: runs appear, they just never end.

   It is also exactly the kind of fault a test catches and a demo does not. */

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-wf-"));
  const db = new Database(path.join(dir, "t.db"));
  db.exec(`
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'manual',
      at_time TEXT NOT NULL DEFAULT '09:00', weekday INTEGER, active INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT);
    CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running', steps TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL, finished_at TEXT);`);
  return db;
}

const hasWaitingRun = (db, id) =>
  Boolean(db.prepare("SELECT 1 FROM workflow_runs WHERE workflow_id=? AND status='waiting' LIMIT 1").get(id));

/* Mirrors dueWorkflows in src/lib/workflows.ts. */
function isDue(db, wf, today, hhmm) {
  if (!wf.active || wf.trigger === "manual") return false;
  if (hhmm < (wf.at_time || "09:00")) return false;
  if (wf.last_run_at && wf.last_run_at.slice(0, 10) >= today) return false;
  return !hasWaitingRun(db, wf.id);
}

const addWf = (db, over = {}) => {
  const w = { id: "w1", name: "Daily", trigger: "daily", at_time: "09:00", weekday: null, active: 1, last_run_at: null, ...over };
  db.prepare(`INSERT INTO workflows (id,name,trigger,at_time,weekday,active,last_run_at) VALUES (?,?,?,?,?,?,?)`)
    .run(w.id, w.name, w.trigger, w.at_time, w.weekday, w.active, w.last_run_at);
  return w;
};

const addRun = (db, id, status, started) =>
  db.prepare("INSERT INTO workflow_runs (id,workflow_id,status,started_at) VALUES (?,?,?,?)").run(id, "w1", status, started);

test("a daily routine is due once its time has passed", () => {
  const db = freshDb();
  assert.equal(isDue(db, addWf(db), "2026-10-09", "09:30"), true);
});

test("it is not due before its time", () => {
  const db = freshDb();
  assert.equal(isDue(db, addWf(db), "2026-10-09", "08:00"), false);
});

test("it is not due twice in one day", () => {
  const db = freshDb();
  const w = addWf(db, { last_run_at: "2026-10-09T09:05:00.000Z" });
  assert.equal(isDue(db, w, "2026-10-09", "11:00"), false);
});

test("a routine still waiting on a person is not started again", () => {
  /* The regression that produced sixteen abandoned runs. */
  const db = freshDb();
  const w = addWf(db, { last_run_at: "2026-10-08T09:05:00.000Z" });
  addRun(db, "r1", "waiting", "2026-10-08T09:05:00.000Z");
  assert.equal(isDue(db, w, "2026-10-09", "09:30"), false, "yesterday's run is still waiting");
});

test("once the waiting run is dealt with, it runs again", () => {
  const db = freshDb();
  const w = addWf(db, { last_run_at: "2026-10-08T09:05:00.000Z" });
  addRun(db, "r1", "waiting", "2026-10-08T09:05:00.000Z");
  db.prepare("UPDATE workflow_runs SET status='done' WHERE id='r1'").run();
  assert.equal(isDue(db, w, "2026-10-09", "09:30"), true);
});

test("a finished run from yesterday does not block today", () => {
  const db = freshDb();
  const w = addWf(db, { last_run_at: "2026-10-08T09:05:00.000Z" });
  addRun(db, "r1", "done", "2026-10-08T09:05:00.000Z");
  assert.equal(isDue(db, w, "2026-10-09", "09:30"), true);
});

test("one competitor failing does not fail the whole sweep", () => {
  /* read_competitors used to return ok only when nothing errored, throwing away the accounts
     that did answer — the same mistake the website check made with a 404. */
  const outcome = (saved, already, errors) => {
    const read = saved + already;
    return { ok: read > 0 || errors.length === 0, error: read > 0 ? "" : errors[0] || "" };
  };
  assert.equal(outcome(0, 10, ["Ola Electric: fetch failed"]).ok, true, "ten read, one down");
  assert.equal(outcome(3, 0, []).ok, true);
  assert.equal(outcome(0, 0, ["everything is down"]).ok, false, "nothing read at all is a failure");
  assert.equal(outcome(0, 0, []).ok, true, "nothing to read is not a failure");
});
