import type { Step, ActionKey } from "@/lib/workflows";

/* A workflow as a graph.

   Circuit's routines started as a list: do this, then this, then that. That is all most of them
   need, but a list cannot say "only email it if the sweep actually found something", and that is
   the first thing anyone wants once they have more than three steps.

   So a workflow is now nodes and the lines between them. A branch node asks one question about
   the step before it and sends the run down one of two lines. Everything else is a node with one
   way in and one way out, which is the same list as before, drawn.

   Nothing had to be migrated: a workflow still stores its shape in the same `steps` column, and
   `toFlow` reads either form. The six built-in routines were written as lists and still are —
   they are turned into a chain on the way to the screen, and saved as a graph the first time
   anyone moves a node. */

export type NodeKind = "trigger" | "action" | "agent" | "you" | "branch";

export type FlowNode = {
  id: string; kind: NodeKind; title: string;
  action?: ActionKey; agent_id?: string; note?: string;
  /* What a branch asks about the node before it. Deliberately three fixed questions rather than
     an expression language: an expression box in a tool like this is a way of writing bugs
     nobody can see until 09:30 on a Tuesday. */
  test?: BranchTest;
  x: number; y: number;
};
export type BranchTest = "found" | "ok" | "waiting";
export type FlowEdge = { from: string; to: string; branch?: "yes" | "no" };
export type Flow = { nodes: FlowNode[]; edges: FlowEdge[] };

export const BRANCH_TESTS: { key: BranchTest; label: string; yes: string; no: string }[] = [
  { key: "found", label: "Did the step before it find anything?", yes: "found something", no: "found nothing" },
  { key: "ok", label: "Did the step before it work?", yes: "worked", no: "failed" },
  { key: "waiting", label: "Is it waiting on a person?", yes: "waiting", no: "not waiting" },
];

export const NODE_W = 232;
export const NODE_H = 76;
const GAP_Y = 118;

const isFlow = (v: unknown): v is Flow =>
  Boolean(v) && typeof v === "object" && Array.isArray((v as Flow).nodes) && Array.isArray((v as Flow).edges);

/* Reads whichever shape a workflow was saved in. A list becomes a trigger with a chain hanging
   off it, laid out down the middle. */
export function toFlow(stepsJson: string): Flow {
  let raw: unknown = [];
  try { raw = JSON.parse(stepsJson || "[]"); } catch { raw = []; }
  if (isFlow(raw)) return raw;

  const steps = (Array.isArray(raw) ? raw : []) as Step[];
  const nodes: FlowNode[] = [{ id: "start", kind: "trigger", title: "When it runs", x: 0, y: 0 }];
  const edges: FlowEdge[] = [];
  steps.forEach((s, i) => {
    const id = `n${i + 1}`;
    nodes.push({ id, kind: s.kind, title: s.title, action: s.action, agent_id: s.agent_id, note: s.note, x: 0, y: (i + 1) * GAP_Y });
    edges.push({ from: i === 0 ? "start" : `n${i}`, to: id });
  });
  return { nodes, edges };
}

export const emptyFlow = (): Flow => ({ nodes: [{ id: "start", kind: "trigger", title: "When it runs", x: 0, y: 0 }], edges: [] });

/* The order a run visits things: follow the lines from the trigger, never visiting a node twice.
   Breadth-first, so two lines out of one node both get their turn rather than one branch running
   to the end while the other waits. */
export function walk(flow: Flow, pick?: (node: FlowNode) => "yes" | "no" | null): FlowNode[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const start = flow.nodes.find((n) => n.kind === "trigger") || flow.nodes[0];
  if (!start) return [];
  const seen = new Set<string>([start.id]);
  const order: FlowNode[] = [];
  const queue: string[] = [start.id];

  while (queue.length) {
    const id = queue.shift() as string;
    const node = byId.get(id);
    if (!node) continue;
    if (node.kind !== "trigger") order.push(node);
    const outs = flow.edges.filter((e) => e.from === id);
    /* A branch only sends the run one way; everything else sends it down every line it has. */
    const taken = node.kind === "branch" && pick
      ? outs.filter((e) => (e.branch || "yes") === (pick(node) || "yes"))
      : outs;
    for (const e of taken) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return order;
}

/* Nodes nothing points at, other than the trigger: they will never run, and saying so is kinder
   than letting someone wonder why their step did nothing at 09:30. */
export function orphans(flow: Flow): FlowNode[] {
  const reachable = new Set(walk(flow).map((n) => n.id));
  return flow.nodes.filter((n) => n.kind !== "trigger" && !reachable.has(n.id));
}

/* Would this line make the run go round for ever? */
export function wouldLoop(flow: Flow, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of flow.edges.filter((x) => x.from === id)) stack.push(e.to);
  }
  return false;
}

export function addNode(flow: Flow, node: Omit<FlowNode, "id">): { flow: Flow; id: string } {
  const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return { flow: { ...flow, nodes: [...flow.nodes, { ...node, id }] }, id };
}

export function removeNode(flow: Flow, id: string): Flow {
  if (flow.nodes.find((n) => n.id === id)?.kind === "trigger") return flow;
  return {
    nodes: flow.nodes.filter((n) => n.id !== id),
    edges: flow.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function connect(flow: Flow, from: string, to: string, branch?: "yes" | "no"): Flow {
  if (from === to || wouldLoop(flow, from, to)) return flow;
  const fromNode = flow.nodes.find((n) => n.id === from);
  /* One line out of an ordinary node, one of each out of a branch — otherwise the picture stops
     describing what will actually happen. */
  const clash = flow.edges.filter((e) => e.from === from && (fromNode?.kind === "branch" ? (e.branch || "yes") === (branch || "yes") : true));
  const kept = flow.edges.filter((e) => !clash.includes(e));
  return { ...flow, edges: [...kept, { from, to, ...(fromNode?.kind === "branch" ? { branch: branch || "yes" } : {}) }] };
}

export const disconnect = (flow: Flow, from: string, to: string): Flow =>
  ({ ...flow, edges: flow.edges.filter((e) => !(e.from === from && e.to === to)) });
