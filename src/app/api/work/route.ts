import { handle, ok, bad, readJson } from "@/lib/http";
import { listTasks, saveTask, remove, TASK_STATUS, TASK_AREAS, type Task } from "@/lib/books";
import { fillWork, suggestWork } from "@/lib/workplan";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  /* ?suggest=1 shows what the board would be filled with, without filling it. */
  if (new URL(req.url).searchParams.get("suggest")) return ok({ suggest: suggestWork() });
  return ok({ tasks: listTasks(), statuses: TASK_STATUS, areas: TASK_AREAS });
});

export const POST = handle(async (req) => {
  const b = await readJson<Partial<Task> & { action?: string }>(req);
  /* Fill the board from the calendar, Circuit's own health and its build queue. */
  if (b.action === "fill") return ok(fillWork(), 201);
  if (!b.title?.trim()) return bad("A task needs a name");
  if (b.status && !TASK_STATUS.includes(b.status as (typeof TASK_STATUS)[number])) return bad("Unknown status");
  if (b.end_date && b.start_date && b.end_date < b.start_date) return bad("The end date is before the start date");
  return ok(saveTask(b), 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<Partial<Task>>(req);
  if (!b.id) return bad("id required");
  if (b.status && !TASK_STATUS.includes(b.status as (typeof TASK_STATUS)[number])) return bad("Unknown status");
  return ok(saveTask(b));
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(remove("tasks", id));
});
