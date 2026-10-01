import { handle, ok, bad, readJson } from "@/lib/http";
import { listAgents, saveAgent, deleteAgent, getAgent, runAgent, seedAgents, CONTEXT_LABEL, type ContextKey } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 800;
seedAgents();

export const GET = handle(async () => ok({ agents: listAgents(), context: CONTEXT_LABEL }));

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; id?: string; name?: string; purpose?: string; prompt?: string; shape?: string; search?: number; context?: ContextKey[]; active?: number; input?: Record<string, unknown> }>(req);
  if (b.action === "run") {
    const agent = b.id ? getAgent(b.id) : undefined;
    if (!agent) return bad("Agent not found", 404);
    return ok(await runAgent(agent, b.input));
  }
  if (!b.name?.trim()) return bad("Give the agent a name");
  return ok(saveAgent({ ...b, name: b.name.trim(), context: JSON.stringify(b.context || []) }));
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  deleteAgent(id);
  return ok({ deleted: id });
});
