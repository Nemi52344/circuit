import { handle, ok, bad, readJson } from "@/lib/http";
import { listTasks, saveTask, remove, TASK_STATUS, TASK_AREAS, DOABLE_BY, type Task } from "@/lib/books";
import { fillWork, suggestWork } from "@/lib/workplan";
import { plantProgramme, PROGRAMME_SIZE } from "@/lib/programme";

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
  return ok({ tasks: listTasks(), statuses: TASK_STATUS, areas: TASK_AREAS, doable: DOABLE_BY, programme_size: PROGRAMME_SIZE });
});

export const POST = handle(async (req) => {
  const b = await readJson<Partial<Task> & { action?: string }>(req);
  /* Fill the board from the calendar, Circuit's own health and its build queue. */
  if (b.action === "fill") return ok(fillWork(), 201);
  /* The standard marketing plan, as opposed to what is already happening here. Kept a separate
     action because the two are different in kind: one is read from the database, this one is a
     template, and merging them would make it impossible to tell which was which. */
  if (b.action === "programme") return ok(plantProgramme(b.start_date), 201);
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
  const fault = timeFault(b);
  if (fault) return bad(fault);
  return ok(saveTask(b));
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(remove("tasks", id));
});
