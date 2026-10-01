import { handle, ok, bad, readJson } from "@/lib/http";
import { listWorkflows, saveWorkflow, deleteWorkflow, runWorkflow, recentRuns, runsFor, seedWorkflows, ACTIONS, type Step } from "@/lib/workflows";
import { BRANCH_TESTS, type Flow } from "@/lib/flow";
import { listAgents } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 800;
seedWorkflows();

export const GET = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return ok({ workflow: listWorkflows().find((w) => w.id === id) || null, runs: runsFor(id) });
  return ok({ workflows: listWorkflows(), agents: listAgents(), actions: ACTIONS, tests: BRANCH_TESTS, runs: recentRuns() });
});

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; id?: string; name?: string; purpose?: string; steps?: Step[] | Flow; trigger?: string; at_time?: string; weekday?: number | null; active?: number; input?: Record<string, unknown> }>(req);
  if (b.action === "run") {
    if (!b.id) return bad("id required");
    return ok(await runWorkflow(b.id, b.input));
  }
  if (!b.name?.trim()) return bad("Give the workflow a name");
  /* The shape a workflow is saved in is whatever the page sent — a list from the old editor, a
     graph from the board. `toFlow` reads either, so both keep working. */
  return ok(saveWorkflow({ ...b, name: b.name.trim(), steps: JSON.stringify(b.steps ?? []) }));
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  deleteWorkflow(id);
  return ok({ deleted: id });
});
