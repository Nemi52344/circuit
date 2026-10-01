import { handle, ok, bad, readJson } from "@/lib/http";
import { listKnowledge, knowledgeCounts, forgetFact, ageKnowledge, KINDS } from "@/lib/knowledge";
import { listAgents, getAgent, runAgent } from "@/lib/agents";
import { getSetting } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 900;

export const GET = handle(async (req) => {
  const kind = new URL(req.url).searchParams.get("kind") || "all";
  ageKnowledge();
  return ok({ facts: listKnowledge({ kind, limit: 120 }), kinds: KINDS, counts: knowledgeCounts(), last_run: getSetting("knowledge_last_run") || "" });
});

/* "Go and learn now" runs the watching agents by hand. They also run every morning from the
   Keep learning routine, which is the point: this button is only for impatience. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; agent?: string }>(req);
  if (b.action !== "learn") return bad("Unknown action");
  const watchers = listAgents().filter((a) => a.active && ["Market watch", "Competitor moves", "Rider listening"].includes(a.name));
  const wanted = b.agent ? watchers.filter((a) => a.name === b.agent) : watchers;
  if (!wanted.length) return bad("No watching agents are set up");
  let added = 0;
  let seen = 0;
  const ran: string[] = [];
  for (const a of wanted) {
    const agent = getAgent(a.id);
    if (!agent) continue;
    const r = await runAgent(agent);
    if (r.filed) { added += r.filed.added; seen += r.filed.seen_again; }
    ran.push(agent.name);
  }
  return ok({ added, seen_again: seen, agents: ran, counts: knowledgeCounts() });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  forgetFact(id);
  return ok({ deleted: id });
});
