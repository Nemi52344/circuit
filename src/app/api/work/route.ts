import { handle, handleUser, ok, bad, readJson } from "@/lib/http";
import { quickAdd, profiles } from "@/lib/inbox";
import { KINDS } from "@/lib/allocate";
import { listTasks, saveTask, remove, TASK_STATUS, TASK_AREAS, DOABLE_BY, type Task } from "@/lib/books";
import { fillWork, suggestWork, syncWork } from "@/lib/workplan";
import { plantProgramme, PROGRAMME_SIZE } from "@/lib/programme";
import { doorFor, doorState, type DoorState } from "@/lib/doors";

export const runtime = "nodejs";

/* Who could do this, and how long it takes. The minutes are what makes an automation figure
   possible at all, so a nonsense value here is worth refusing rather than storing. */
const timeFault = (b: Partial<Task>): string | null => {
  if (b.doable_by !== undefined && !DOABLE_BY.includes(b.doable_by as (typeof DOABLE_BY)[number])) return "Say whether a person or Circuit could do this";
  for (const k of ["estimate_minutes", "spent_minutes"] as const) {
    const v = b[k];
    if (v === undefined || v === null) continue;
    if (!Number.isFinite(v) || v < 0) return "Minutes cannot be negative";
    if (v > 60 * 24 * 30) return "That is more than a month of minutes — check the number";
  }
  return null;
};

export const GET = handle(async (req) => {
  /* ?suggest=1 shows what the board would be filled with, without filling it. */
  if (new URL(req.url).searchParams.get("suggest")) return ok({ suggest: suggestWork() });
  /* Each task's door, read live — what Circuit can do about it and what it already holds. A
     door is resolved once per distinct key rather than once per task, because several pieces of
     work share one (three of them open the poster studio) and each check is a query. */
  /* The board brings itself up to date every time it is opened, so the Gantt is never a
     picture of last week. */
  try { syncWork(); } catch { /* a stale board is better than no board */ }
  const tasks = listTasks();
  const doors: Record<string, DoorState> = {};
  for (const key of new Set(tasks.map((t) => t.door).filter((d): d is string => Boolean(d)))) {
    const st = doorState(key);
    if (st) doors[key] = st;
  }
  /* Who the board is shared between, for the lanes and the "give to" menu. */
  const team = profiles().filter((p) => p.takes_work).map((p) => ({ id: p.user_id, name: p.name, login: p.login, kinds: p.kinds }));
  return ok({ tasks, statuses: TASK_STATUS, areas: TASK_AREAS, doable: DOABLE_BY, programme_size: PROGRAMME_SIZE, doors, team, kinds: KINDS.map((k) => ({ key: k.key, label: k.label })) });
});

export const POST = handleUser(async (req, user) => {
  const b = await readJson<Partial<Task> & { action?: string; text?: string; assignee?: string; due?: string }>(req);
  /* One line or a pasted list, each line a task, each given to the right person. */
  if (b.action === "quick") return ok({ tasks: quickAdd(b.text || "", user, { assignee: b.assignee, due: b.due, priority: b.priority }) }, 201);
  /* Fill the board from the calendar, Circuit's own health and its build queue. */
  if (b.action === "fill") return ok(fillWork(), 201);
  /* The standard marketing plan, as opposed to what is already happening here. Kept a separate
     action because the two are different in kind: one is read from the database, this one is a
     template, and merging them would make it impossible to tell which was which. */
  if (b.action === "programme") return ok(plantProgramme(b.start_date), 201);

  /* Pressing a task's door. This is the whole point of the board: a piece of work that Circuit
     can do should be done from the row, not ticked on it. */
  if (b.action === "do") {
    if (!b.id) return bad("id required");
    const task = listTasks().find((t) => t.id === b.id);
    if (!task) return bad("That piece of work is not here any more", 404);
    const door = task.door ? doorFor(task.door) : undefined;
    if (!door) return bad("Circuit has nothing it can run for this one — it is yours");
    if (door.kind !== "run" || !door.run) return bad(`This one opens ${door.href} rather than running here`);
    const holds = door.holds();
    /* Refused rather than attempted: running an action whose inputs are missing produces an
       error from three layers down that reads like a fault in Circuit. */
    if (!holds.ready) return bad(holds.line);
    try {
      const began = Date.now();
      const r = await door.run();
      /* The time Circuit spent is logged against the task, and work that was only planned is now
         under way — nobody has to tick either. */
      const mins = Math.max(1, Math.round((Date.now() - began) / 60000));
      saveTask({ id: task.id, spent_minutes: (task.spent_minutes || 0) + mins, status: task.status === "planned" ? "doing" : task.status });
      return ok({ ...r, task: b.id, logged_minutes: mins }, 201);
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (!b.title?.trim()) return bad("A task needs a name");
  if (b.status && !TASK_STATUS.includes(b.status as (typeof TASK_STATUS)[number])) return bad("Unknown status");
  if (b.end_date && b.start_date && b.end_date < b.start_date) return bad("The end date is before the start date");
  const fault = timeFault(b);
  if (fault) return bad(fault);
  return ok(saveTask(b), 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<Partial<Task>>(req);
  if (!b.id) return bad("id required");
  if (b.status && !TASK_STATUS.includes(b.status as (typeof TASK_STATUS)[number])) return bad("Unknown status");
  if (b.priority !== undefined && !["high", "normal", "low"].includes(b.priority)) return bad("Unknown priority");
  if (b.kind !== undefined && !KINDS.some((k) => k.key === b.kind)) return bad("Unknown kind of work");
  const fault = timeFault(b);
  if (fault) return bad(fault);
  return ok(saveTask(b));
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(remove("tasks", id));
});
