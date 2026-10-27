import { getDb, getSetting } from "@/lib/db";
import { listTasks, saveTask, type Task, type StockItem } from "@/lib/books";
import { stockOutlook } from "@/lib/stockmath";

/* Filling the board from what is already happening.

   A work board nobody fills in is worse than no board, and the first entry is the one people
   never make. But Circuit already knows what is on: a month of posts with pillars and dates,
   things it has flagged as wrong with itself, and the work it has proposed on its own code.
   All of that is real work with real dates, so the board can start full instead of empty.

   Nothing here is invented. Every task points at something already in the database, and the
   dates come from that thing rather than from a guess. Anything that cannot be traced back to
   a record does not get suggested. */

export type Suggested = Omit<Task, "id" | "created_at" | "updated_at"> & { why: string };

const today = () => new Date().toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export function suggestWork(): Suggested[] {
  const db = getDb();
  const out: Suggested[] = [];

  /* A month of content is one piece of work per pillar, not twenty-one separate jobs. The bar
     runs from the first post to the last, and fills as the posts get through their steps. */
  const pillars = db.prepare(`
    SELECT COALESCE(p.name, 'Unassigned') name, COUNT(*) n, MIN(s.date) first, MAX(s.date) last,
           SUM(CASE WHEN s.status = 'posted' THEN 1 ELSE 0 END) posted,
           SUM(CASE WHEN s.stage >= 8 OR s.status IN ('scheduled','posted') THEN 1 ELSE 0 END) ready
    FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id
    WHERE s.date >= ? GROUP BY p.id ORDER BY n DESC`).all(today().slice(0, 8) + "01") as
    { name: string; n: number; first: string; last: string; posted: number; ready: number }[];

  for (const p of pillars) {
    const month = new Date(`${p.first}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    out.push({
      title: `${p.name} — ${month} posts`,
      notes: `${p.n} posts planned between ${p.first} and ${p.last}. Progress follows how far they get through their steps.`,
      owner: "", area: "marketing",
      start_date: p.first, end_date: p.last,
      status: p.posted === p.n ? "done" : p.ready ? "doing" : "planned",
      progress: Math.round((p.ready / Math.max(p.n, 1)) * 100),
      depends_on: null,
      why: `${p.n} slots on the calendar`,
    });
  }

  /* What Circuit has already said is wrong with itself. These are jobs whether or not anyone
     writes them down, so writing them down costs nothing and forgetting them costs something. */
  if (!(db.prepare("SELECT COUNT(*) n FROM approvers").get() as { n: number }).n) {
    out.push({
      title: "Set up who signs off posts",
      notes: "Nobody is set up, so posts go out on one person's word. Settings → Sign-off.",
      owner: "", area: "marketing", start_date: today(), end_date: plus(7),
      status: "planned", progress: 0, depends_on: null, why: "no approvers in the database",
    });
  }

  const photos = (db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n;
  if (photos <= 1) {
    out.push({
      title: "Photograph more of the bikes",
      notes: `Only ${photos} product photo${photos === 1 ? "" : "s"} on file, so every draft is built from the same picture.`,
      owner: "", area: "marketing", start_date: today(), end_date: plus(21),
      status: "planned", progress: 0, depends_on: null, why: `${photos} product photo on file`,
    });
  }

  if (!getSetting("postiz_key")) {
    out.push({
      title: "Connect Postiz so posts publish themselves",
      notes: "Circuit can hand finished posts to Postiz, but the key and the channel map are not set yet. Settings → Publishing.",
      owner: "", area: "marketing", start_date: today(), end_date: plus(14),
      status: "planned", progress: 0, depends_on: null, why: "no Postiz key saved",
    });
  }

  /* Stock. Each item's details are entered once; after that what is left is worked out from
     how many get used a month, and the reorder is raised as work the day it falls due — not
     when somebody notices the shelf is empty. A count over a month old raises a count. */
  const stock = db.prepare("SELECT * FROM stock").all() as StockItem[];
  for (const it of stock) {
    const o = stockOutlook(it);
    if (!o.low) continue;
    out.push({
      title: `Reorder ${it.item}`,
      notes: `About ${o.left} ${it.unit} left against a reorder level of ${it.reorder_at}${o.runs_out ? `; runs out around ${o.runs_out}` : ""}. Enter the new quantity in Admin → Stock when it arrives.`,
      owner: "", area: "admin", start_date: today(), end_date: o.runs_out && o.runs_out > today() ? o.runs_out : plus(7),
      status: "planned", progress: 0, depends_on: null, why: `${it.item} at or below reorder`,
    });
  }
  if (stock.some((it) => stockOutlook(it).stale)) {
    out.push({
      title: "Count the stock",
      notes: "At least one item has not been counted for over a month, so what is left is an estimate on an estimate. Put the real numbers in Admin → Stock.",
      owner: "", area: "admin", start_date: today(), end_date: plus(7),
      status: "planned", progress: 0, depends_on: null, why: "a stock count over a month old",
    });
  }

  /* Work Circuit proposed on its own code and nobody has picked up. */
  const proposed = db.prepare("SELECT title, why, effort FROM roadmap WHERE status = 'proposed' ORDER BY created_at").all() as
    { title: string; why: string; effort: string }[];
  for (const r of proposed) {
    out.push({
      title: r.title,
      notes: (r.why || "Proposed on the What to build board.").slice(0, 400),
      owner: "", area: "product", start_date: today(), end_date: plus(30),
      status: "planned", progress: 0, depends_on: null, why: "proposed on What to build",
    });
  }

  return out;
}

/* Puts the suggestions on the board, and keeps the ones already there honest.

   Matching is on the title, which is blunt but right: pressing the button again tops the board
   up rather than doubling it.

   A content bar that never moves is a dead chart, so an existing content task has its dates and
   its progress refreshed from the calendar — the posts underneath it have moved on since it was
   added. What is not touched is anything a person decided: the title, the owner, the notes, and
   a task somebody has marked done. Circuit reports the state; it does not overrule the reading
   of it. */
export function fillWork(): { added: Task[]; updated: Task[]; skipped: string[] } {
  const existing = new Map(listTasks().map((t) => [t.title.trim().toLowerCase(), t]));
  const added: Task[] = [];
  const updated: Task[] = [];
  const skipped: string[] = [];

  for (const s of suggestWork()) {
    const key = s.title.trim().toLowerCase();
    const have = existing.get(key);
    if (!have) {
      const { why, ...task } = s;
      void why;
      const made = saveTask(task);
      added.push(made);
      existing.set(key, made);
      continue;
    }
    /* Only the month's content bars follow the calendar. The rest are one-off jobs whose
       progress is a person's judgement, not something that can be read off a table. */
    const derived = /— [A-Z][a-z]+ posts$/.test(s.title);
    const settled = have.progress === s.progress && have.end_date === s.end_date
      && (have.status === "blocked" || have.status === (s.progress >= 100 ? "done" : s.progress > 0 ? "doing" : "planned"));
    if (!derived || settled) {
      skipped.push(s.title);
      continue;
    }
    /* For a content bar the status is not a separate opinion — it is what the progress says.
       Deriving it both ways means it corrects itself if posts slip backwards, instead of
       sitting on "doing" forever. "Blocked" is the exception: only a person can know that, and
       only a person should clear it. */
    const status = have.status === "blocked" ? "blocked"
      : s.progress >= 100 ? "done" : s.progress > 0 ? "doing" : "planned";
    updated.push(saveTask({
      id: have.id, progress: s.progress, start_date: s.start_date, end_date: s.end_date, status,
    }));
  }
  return { added, updated, skipped };
}

/* The board, kept up to date without anybody pressing anything.

   Three things move on their own. A month's content bar follows the calendar (fillWork, run
   here rather than waiting for the button). A one-off job Circuit raised because something was
   missing — no approvers, one product photo, no Postiz key — closes itself when that thing is
   no longer missing, since the condition that made it a job is gone. And new work Circuit can
   trace to a record is added as it appears. What a person decided is still left alone: a task
   somebody marked blocked, and anything they wrote themselves. */
const RAISED_BY_CIRCUIT = ["Set up who signs off posts", "Photograph more of the bikes", "Connect Postiz so posts publish themselves"];

export function syncWork(): { added: number; updated: number; closed: number } {
  const filled = fillWork();
  const still = new Set(suggestWork().map((s) => s.title));
  let closed = 0;
  for (const t of listTasks()) {
    const raised = RAISED_BY_CIRCUIT.includes(t.title) || t.title === "Count the stock" || t.title.startsWith("Reorder ");
    if (!raised || still.has(t.title) || t.status === "done" || t.status === "blocked") continue;
    saveTask({ id: t.id, status: "done", progress: 100 });
    closed += 1;
  }
  return { added: filled.added.length, updated: filled.updated.length, closed };
}
