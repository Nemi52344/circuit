import { getDb, newId, now } from "@/lib/db";
import { getAgent, runAgent, seedAgents } from "@/lib/agents";
import { syncCompetitorInstagram } from "@/lib/igsync";
import { syncOwnInstagram } from "@/lib/insights";
import { tagPosters, postersLeft } from "@/lib/postertags";
import { queueTopicIdeas } from "@/lib/research";
import { toFlow, BRANCH_TESTS, type BranchTest } from "@/lib/flow";

/* A workflow is a routine written down: the steps, in order, and when it should run.

   Three kinds of step:
   - action: something Circuit already knows how to do (read competitors, pull our numbers,
     look at posters, ask for topic ideas)
   - agent: one of your agents, run on what Circuit knows
   - you: a step only a person can do. The run stops there and waits, rather than pretending.

   A run keeps every step's answer, so a workflow is also a record of what happened. */

export type StepKind = "action" | "agent" | "you";
export type Step = { kind: StepKind; title: string; action?: ActionKey; agent_id?: string; note?: string };
export type Workflow = {
  id: string; name: string; purpose: string; steps: string; trigger: string; at_time: string;
  weekday: number | null; builtin: number; active: number; last_run_at: string | null; created_at: string; updated_at: string;
};
export type RunStep = {
  title: string; kind: StepKind | "branch"; status: "done" | "failed" | "waiting" | "skipped";
  output?: unknown; error?: string; seconds?: number;
  /* Which node on the board this was. Titles are what a person reads; this is what the machine
     resumes from, because two nodes may legitimately share a name. */
  node?: string;
};
export type Run = { id: string; workflow_id: string; status: string; steps: string; started_at: string; finished_at: string | null };

export type ActionKey = "read_competitors" | "pull_our_numbers" | "look_at_posters" | "ask_for_ideas" | "back_up" | "take_briefing" | "daily_intel" | "email_intel" | "read_comments" | "draft_replies" | "check_website" | "posts_due";

export const ACTIONS: { key: ActionKey; label: string; note: string }[] = [
  { key: "read_competitors", label: "Read competitors' Instagram", note: "Saves anything new from the last 7 days" },
  { key: "pull_our_numbers", label: "Pull our own numbers", note: "Reach, likes, comments and saves from Instagram" },
  { key: "look_at_posters", label: "Look at our posters", note: "Describes six more, so the picture findings improve" },
  { key: "ask_for_ideas", label: "Ask for topic ideas", note: "For posts in the next two weeks with no topic" },
  { key: "back_up", label: "Back up", note: "A copy of the database and pictures" },
  { key: "check_website", label: "Read the website again", note: "Says what changed since last time — pages added, gone or edited" },
  { key: "posts_due", label: "What is due to go out", note: "Posts past their date or due in the next two days" },
  { key: "read_comments", label: "Read comments on our posts", note: "Instagram, when the token allows it" },
  { key: "draft_replies", label: "Draft replies to new comments", note: "In our voice — they wait for you to send them" },
  { key: "take_briefing", label: "Take the briefing from the folder", note: "Picks up the PDF Claude made and files it" },
  { key: "daily_intel", label: "Sweep the daily intel here instead", note: "Circuit does the sweep itself — only if Claude hasn't" },
  { key: "email_intel", label: "Email this morning's intel", note: "Sends the latest briefing through your Zapier hook" },
];

async function runAction(key: ActionKey): Promise<{ ok: boolean; output: unknown; error: string }> {
  try {
    switch (key) {
      case "read_competitors": {
        const r = await syncCompetitorInstagram(7);
        return { ok: !r.errors.length, output: { saved: r.saved, already: r.already, errors: r.errors }, error: r.errors[0] || "" };
      }
      case "pull_our_numbers": {
        const r = await syncOwnInstagram(50);
        return { ok: !r.errors.length, output: { read: r.read, stored: r.stored, matched: r.matched }, error: r.errors[0] || "" };
      }
      case "look_at_posters": {
        const r = await tagPosters(6);
        return { ok: !r.errors.length, output: { described: r.tagged, left: postersLeft() }, error: r.errors[0] || "" };
      }
      case "ask_for_ideas": {
        const r = queueTopicIdeas(14);
        return { ok: true, output: { queued: r.queued }, error: "" };
      }
      case "check_website": {
        const { checkWebsite } = await import("@/lib/mywork");
        const r = await checkWebsite();
        /* The step worked if the site answered at all. Broken pages are findings, not faults. */
        return {
          ok: r.pages > 0,
          output: r.first
            ? { pages: r.pages, note: "First reading — nothing to compare against yet" }
            : { pages: r.pages, changes: r.changes.length, what: r.changes.slice(0, 10).map((c) => `${c.kind}: ${c.url}${c.kind === "broken" ? ` (${c.now})` : ""}`) },
          error: r.pages ? "" : "The website did not answer at all",
        };
      }
      case "posts_due": {
        const { postsDue } = await import("@/lib/mywork");
        const r = postsDue(2);
        return { ok: true, output: { due: r.due.length, late: r.late, next: r.due.slice(0, 6).map((d) => `${d.platform} · ${d.when.slice(0, 10)}${d.late ? " · late" : ""}`) }, error: "" };
      }
      case "read_comments": {
        const { pullInstagram } = await import("@/lib/listen");
        const r = await pullInstagram(10);
        return { ok: !r.errors.length, output: { found: r.found, added: r.added }, error: r.errors[0] || "" };
      }
      case "draft_replies": {
        /* Drafts only. Nothing in Circuit posts a reply — a branch after this one can tell you
           there is something waiting, but a person still presses send. */
        const { draftReplies } = await import("@/lib/listen");
        const r = await draftReplies(12);
        return { ok: !r.errors.length, output: { drafted: r.drafted, waiting_for_you: r.drafted }, error: r.errors[0] || "" };
      }
      case "take_briefing": {
        /* Claude makes the briefing; this is the hand-over. Nothing waiting is not a failure —
           most mornings the folder is checked long before the PDF is dropped in. */
        const { takeFromFolder } = await import("@/lib/intelinbox");
        const r = await takeFromFolder();
        if (!r.taken.length) return { ok: !r.errors.length, output: { taken: 0 }, error: r.errors[0] || "" };
        return { ok: !r.errors.length, output: { taken: r.taken.length, dates: r.taken.map((t) => t.date), link: r.taken[0].url }, error: r.errors[0] || "" };
      }
      case "daily_intel": {
        /* The whole sweep, PDF included. This used to call runIntel() alone, which left the
           morning with an archive entry and no briefing anyone could open or attach. */
        const { sweepBriefing } = await import("@/lib/intelrun");
        const r = await sweepBriefing();
        return {
          ok: true,
          output: { items: r.run.items.length, theme: r.run.theme, learned: r.run.filed?.added || 0, pdf: r.pdf?.name || "", link: r.pdf_url || "" },
          error: r.pdf_error,
        };
      }
      case "email_intel": {
        /* Microsoft carries the PDF itself; the Zapier hook carries the words and the link,
           which Zapier fetches at the far end and attaches as the real file. */
        const { latestPdf } = await import("@/lib/intelpdf");
        const { graphSettings, sendGraphMail } = await import("@/lib/graphmail");
        const pdf = latestPdf();
        const { briefingNote } = await import("@/lib/intelpdf");
        if (graphSettings().ready && pdf) {
          const note = briefingNote(pdf.date, pdf.theme, pdf.items);
          const sent = await sendGraphMail({ subject: note.subject, html: note.html, kind: "intel", attachments: [{ name: pdf.name, mime: pdf.mime, bytes: Buffer.from(pdf.bytes) }] });
          return { ok: sent.status === "sent", output: { to: sent.to_address, attached: pdf.name }, error: sent.error };
        }
        /* Without Microsoft, the hook carries the words and the link Supabase gave the PDF —
           Zapier will fetch that link and attach the real file at the far end. */
        const { sendMail } = await import("@/lib/outbox");
        if (!pdf) return { ok: false, output: null, error: "There is no briefing to send yet" };
        const note = briefingNote(pdf.date, pdf.theme, pdf.items);
        const link = pdf.pdf_url || "";
        const sent = await sendMail({
          to: "", subject: note.subject, body: link ? `${note.text}\n\nThe briefing PDF: ${link}` : note.text,
          html: note.html, kind: "intel",
          attachment_url: link, attachment_name: link ? pdf.name : "",
        });
        return {
          ok: sent.status === "sent",
          output: { to: sent.to_address, subject: sent.subject, attached: link ? pdf?.name || "" : "nothing — no Supabase link yet, so there is no file Zapier can fetch" },
          error: sent.error,
        };
      }
      case "back_up": {
        const { runBackup } = await import("@/lib/backup");
        const r = await runBackup();
        return { ok: true, output: { pictures: r.pictures, bytes: r.db_bytes }, error: "" };
      }
      default:
        return { ok: false, output: null, error: `Unknown action ${key}` };
    }
  } catch (e) {
    return { ok: false, output: null, error: (e as Error).message };
  }
}

export function listWorkflows(): Workflow[] {
  return getDb().prepare("SELECT * FROM workflows ORDER BY builtin DESC, name").all() as Workflow[];
}
export function getWorkflow(id: string): Workflow | undefined {
  return getDb().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as Workflow | undefined;
}
export function runsFor(id: string, limit = 8): Run[] {
  return getDb().prepare("SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?").all(id, limit) as Run[];
}
/* A run whose process died — the app restarted, the laptop slept, a step was abandoned — leaves
   a row saying "running" that nothing ever finishes. It then sits in the history for ever,
   looking like work still in progress. Anything still claiming to be running after an hour is
   not running; it is gone, and saying so is more honest than leaving a spinner on a corpse. */
export function sweepStuckRuns(olderThanMinutes = 60): number {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();
  const r = getDb().prepare(
    `UPDATE workflow_runs SET status = 'failed', finished_at = ?,
       steps = CASE WHEN steps = '[]' OR steps = '' THEN ? ELSE steps END
     WHERE status = 'running' AND started_at < ?`,
  ).run(now(), JSON.stringify([{ title: "Abandoned", kind: "action", status: "failed", error: "The app stopped before this run finished." }]), cutoff);
  return r.changes;
}

export function recentRuns(limit = 12): (Run & { name: string })[] {
  sweepStuckRuns();
  return getDb().prepare(`SELECT r.*, w.name FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id ORDER BY r.started_at DESC LIMIT ?`).all(limit) as (Run & { name: string })[];
}

export function saveWorkflow(w: Partial<Workflow> & { name: string }) {
  const db = getDb();
  if (w.id) {
    db.prepare(`UPDATE workflows SET name = ?, purpose = ?, steps = ?, trigger = ?, at_time = ?, weekday = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(w.name, w.purpose || "", w.steps || "[]", w.trigger || "manual", w.at_time || "09:00", w.weekday ?? null, w.active ?? 1, now(), w.id);
    return getWorkflow(w.id)!;
  }
  const id = newId();
  db.prepare(`INSERT INTO workflows (id, name, purpose, steps, trigger, at_time, weekday, builtin, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`)
    .run(id, w.name, w.purpose || "", w.steps || "[]", w.trigger || "manual", w.at_time || "09:00", w.weekday ?? null, now(), now());
  return getWorkflow(id)!;
}

export function deleteWorkflow(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM workflow_runs WHERE workflow_id = ?").run(id);
  db.prepare("DELETE FROM workflows WHERE id = ? AND builtin = 0").run(id);
}

/* Runs the steps in order. A "you" step stops the run and marks it waiting: Circuit will not
   pretend to have done something a person has to do. */
export async function runWorkflow(id: string, input?: Record<string, unknown>): Promise<Run> {
  const wf = getWorkflow(id);
  if (!wf) throw new Error("Workflow not found");
  const runId = newId();
  getDb().prepare("INSERT INTO workflow_runs (id, workflow_id, status, steps, started_at) VALUES (?, ?, 'running', '[]', ?)").run(runId, id, now());
  return drive(runId, id, toFlow(wf.steps), null, [], input);
}

/* Picking a stopped run back up.

   A workflow that stops at a step only a person can do used to mean starting the whole thing
   again — reading the website twice, pulling the same numbers twice — just to get past the one
   box somebody had since ticked. The run already knows where it stopped, so it carries on from
   there with everything above it left alone. */
export async function resumeWorkflow(runId: string, input?: Record<string, unknown>): Promise<Run> {
  const db = getDb();
  const run = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId) as Run | undefined;
  if (!run) throw new Error("That run is not here any more");
  if (run.status !== "waiting") throw new Error("That run is not waiting on anything");
  const wf = getWorkflow(run.workflow_id);
  if (!wf) throw new Error("Workflow not found");

  let already: RunStep[] = [];
  try { already = JSON.parse(run.steps || "[]"); } catch { already = []; }
  const stopped = already.find((x) => x.status === "waiting");
  if (!stopped?.node) throw new Error("This run was recorded before Circuit kept track of where it stopped, so it has to be run again from the start");

  /* The step a person has now done is marked done, and the run goes on from its node. */
  const carried = already.map((x) => (x === stopped ? { ...x, status: "done" as const, output: "You did this and said so." } : x));
  db.prepare("UPDATE workflow_runs SET status = 'running', steps = ?, finished_at = NULL WHERE id = ?").run(JSON.stringify(carried), runId);
  return drive(runId, run.workflow_id, toFlow(wf.steps), stopped.node, carried, input);
}

/* One engine, whether a run is starting or carrying on. `from` is the node already dealt with,
   so the walk begins at whatever that node points to; everything in `carried` is left alone. */
async function drive(
  runId: string, id: string, flow: ReturnType<typeof toFlow>,
  from: string | null, carried: RunStep[], input?: Record<string, unknown>,
): Promise<Run> {
  const db = getDb();
  const done: RunStep[] = [...carried];
  let status = "done";

  /* What the node before this one came back with — the only thing a branch gets to ask about.
     Keeping the question that narrow is what stops this becoming a scripting language. */
  const tail = carried[carried.length - 1];
  let last: { ok: boolean; waiting: boolean; output: unknown } =
    tail ? { ok: tail.status !== "failed", waiting: false, output: tail.output ?? null } : { ok: true, waiting: false, output: null };
  const answers = (test: BranchTest | undefined): "yes" | "no" => {
    if (test === "ok") return last.ok ? "yes" : "no";
    if (test === "waiting") return last.waiting ? "yes" : "no";
    /* "found" means the step came back with something rather than nothing: a number above zero,
       a list with items in it, or any text at all. */
    const o = last.output;
    if (o === null || o === undefined || o === "") return "no";
    if (typeof o === "number") return o > 0 ? "yes" : "no";
    if (Array.isArray(o)) return o.length ? "yes" : "no";
    if (typeof o === "object") {
      const vals = Object.values(o as Record<string, unknown>);
      return vals.some((v) => (typeof v === "number" ? v > 0 : Array.isArray(v) ? v.length > 0 : Boolean(v))) ? "yes" : "no";
    }
    return "yes";
  };

  /* The run walks the graph itself rather than being handed a route worked out in advance.
     It has to: a branch's answer depends on what the node before it just came back with, and
     that does not exist until the run gets there. Planning the whole path up front made every
     branch read an empty result and take the same line every time. */
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const startNode = flow.nodes.find((n) => n.kind === "trigger") || flow.nodes[0];
  /* Resuming: start from what the finished node points at, and treat everything already run as
     visited so no step is done twice. Starting fresh: begin at the trigger. */
  const visited = new Set<string>(carried.map((x) => x.node || "").filter(Boolean));
  const queued: string[] = [];
  if (from) {
    visited.add(from);
    for (const e of flow.edges.filter((x) => x.from === from)) if (!visited.has(e.to)) { visited.add(e.to); queued.push(e.to); }
  } else if (startNode) {
    visited.add(startNode.id);
    queued.push(startNode.id);
  }

  while (queued.length) {
    const nodeId = queued.shift() as string;
    const step = byId.get(nodeId);
    if (!step) continue;

    const follow = (way?: "yes" | "no") => {
      for (const e of flow.edges.filter((x) => x.from === nodeId)) {
        if (way && (e.branch || "yes") !== way) continue;
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        queued.push(e.to);
      }
    };

    if (step.kind === "trigger") { follow(); continue; }

    if (step.kind === "branch") {
      const way = answers(step.test);
      const t = BRANCH_TESTS.find((b) => b.key === (step.test || "found"));
      done.push({ node: nodeId, title: step.title || t?.label || "Branch", kind: "branch", status: "done", output: way === "yes" ? t?.yes : t?.no });
      db.prepare("UPDATE workflow_runs SET steps = ? WHERE id = ?").run(JSON.stringify(done), runId);
      follow(way);
      continue;
    }
    if (step.kind === "you") {
      // a step that asks for something is satisfied when the run was started with it
      const asksForText = /paste|upload|attach/i.test(step.title);
      const given = typeof input?.pasted_text === "string" && input.pasted_text.trim().length > 0;
      if (asksForText && given) {
        done.push({ node: nodeId, title: step.title, kind: "you", status: "done", output: `You gave ${String(input!.pasted_text).length} characters of text.` });
        last = { ok: true, waiting: false, output: input!.pasted_text };
        follow();
        continue;
      }
      done.push({ node: nodeId, title: step.title, kind: "you", status: "waiting", output: step.note || "" });
      last = { ok: true, waiting: true, output: null };
      status = "waiting";
      break;
    }
    if (step.kind === "action" && step.action) {
      const r = await runAction(step.action);
      done.push({ node: nodeId, title: step.title, kind: "action", status: r.ok ? "done" : "failed", output: r.output, error: r.error });
      last = { ok: r.ok, waiting: false, output: r.output };
      if (!r.ok) status = "failed";
    }
    if (step.kind === "agent" && step.agent_id) {
      const agent = getAgent(step.agent_id);
      if (!agent) {
        done.push({ node: nodeId, title: step.title, kind: "agent", status: "failed", error: "That agent has been deleted" });
        last = { ok: false, waiting: false, output: null };
        status = "failed";
      } else {
        const r = await runAgent(agent, input);
        done.push({ node: nodeId, title: step.title || agent.name, kind: "agent", status: r.ok ? "done" : "failed", output: r.answer, error: r.error, seconds: r.seconds });
        last = { ok: r.ok, waiting: false, output: r.answer };
        if (!r.ok) status = "failed";
      }
    }
    follow();
    db.prepare("UPDATE workflow_runs SET steps = ? WHERE id = ?").run(JSON.stringify(done), runId);
  }

  db.prepare("UPDATE workflow_runs SET status = ?, steps = ?, finished_at = ? WHERE id = ?").run(status, JSON.stringify(done), now(), runId);
  db.prepare("UPDATE workflows SET last_run_at = ? WHERE id = ?").run(now(), id);
  return db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId) as Run;
}

/* Which routines are due. Daily ones run once after their time; weekly ones on their day. */
export function dueWorkflows(): Workflow[] {
  const nowD = new Date();
  const hhmm = `${String(nowD.getHours()).padStart(2, "0")}:${String(nowD.getMinutes()).padStart(2, "0")}`;
  const today = nowD.toISOString().slice(0, 10);
  return listWorkflows().filter((w) => {
    if (!w.active || w.trigger === "manual") return false;
    if (w.trigger === "weekly" && w.weekday !== null && w.weekday !== nowD.getDay()) return false;
    if (hhmm < (w.at_time || "09:00")) return false;
    return !w.last_run_at || w.last_run_at.slice(0, 10) < today;
  });
}

/* The daily intel routine used to do the sweep itself. Claude does it better and does it
   anyway, so the routine's job is now to collect that PDF and send it. Anyone already running
   the old version gets moved across once, quietly, without losing the workflow's history. */
function upgradeIntelRoutine() {
  const db = getDb();
  const row = db.prepare("SELECT id, steps FROM workflows WHERE name = 'Nemi daily intel' AND builtin = 1").get() as { id: string; steps: string } | undefined;
  if (!row || !row.steps.includes('"daily_intel"')) return;
  const steps: Step[] = [
    { kind: "action", title: "Take the briefing from the folder", action: "take_briefing" },
    { kind: "action", title: "Email it", action: "email_intel" },
  ];
  db.prepare("UPDATE workflows SET steps = ?, at_time = '09:30', purpose = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(steps), "Takes the briefing Claude made this morning, files it and emails it out", now(), row.id);
}

/* The routines Circuit ships with, wired to the agents it ships with. */
export function seedWorkflows() {
  seedAgents();
  const db = getDb();
  upgradeIntelRoutine();
  if ((db.prepare("SELECT COUNT(*) n FROM workflows WHERE builtin = 1").get() as { n: number }).n) return 0;
  const agentId = (name: string) => (db.prepare("SELECT id FROM agents WHERE name = ?").get(name) as { id: string } | undefined)?.id || "";

  const list: { name: string; purpose: string; trigger: string; at_time: string; weekday?: number; steps: Step[] }[] = [
    {
      name: "Every morning",
      purpose: "Reads competitors, pulls our numbers, and tells you what needs doing today",
      trigger: "daily", at_time: "08:30",
      steps: [
        { kind: "action", title: "Read competitors' Instagram", action: "read_competitors" },
        { kind: "action", title: "Pull our own numbers", action: "pull_our_numbers" },
        { kind: "agent", title: "What needs doing today", agent_id: agentId("Morning marketing check") },
      ],
    },
    {
      name: "Content creation",
      purpose: "Takes the month from empty days to researched posts ready to draft",
      trigger: "manual", at_time: "09:00",
      steps: [
        { kind: "action", title: "Ask ChatGPT for topic ideas", action: "ask_for_ideas" },
        { kind: "you", title: "Pick the topics you want", note: "Open All posts and take an idea on each post, or take the first idea on all of them at once." },
        { kind: "you", title: "Create the drafts", note: "Each post's step 4 draws the pictures. Come back when you have picked the ones you like." },
      ],
    },
    {
      name: "Keep learning",
      purpose: "Goes out to the internet every day and files what changed, so the rest of the app gets better on its own",
      trigger: "daily", at_time: "07:00",
      steps: [
        { kind: "agent", title: "What changed in the market", agent_id: agentId("Market watch") },
        { kind: "agent", title: "What competitors did", agent_id: agentId("Competitor moves") },
        { kind: "agent", title: "What riders are saying", agent_id: agentId("Rider listening") },
        { kind: "action", title: "Read competitors' Instagram", action: "read_competitors" },
        { kind: "action", title: "Look at more of our posters", action: "look_at_posters" },
      ],
    },
    {
      name: "Nemi daily intel",
      purpose: "Takes the briefing Claude made this morning, files it and emails it out",
      trigger: "daily", at_time: "09:30",
      steps: [
        { kind: "action", title: "Take the briefing from the folder", action: "take_briefing" },
        { kind: "action", title: "Email it", action: "email_intel" },
      ],
    },
    {
      name: "Weekly review",
      purpose: "Looks at the week's numbers and our posters, then writes the note",
      trigger: "weekly", at_time: "09:00", weekday: 1,
      steps: [
        { kind: "action", title: "Pull our own numbers", action: "pull_our_numbers" },
        { kind: "action", title: "Look at more of our posters", action: "look_at_posters" },
        { kind: "agent", title: "Write the week's note", agent_id: agentId("Weekly performance note") },
        { kind: "action", title: "Back up", action: "back_up" },
      ],
    },
    {
      name: "Bill or invoice intake",
      purpose: "Reads a bill you paste in and files what it says",
      trigger: "manual", at_time: "09:00",
      steps: [
        { kind: "you", title: "Paste the bill text or upload it", note: "Paste the text from the email or PDF into the box when you run this." },
        { kind: "agent", title: "Read the bill", agent_id: agentId("Bill reader") },
        { kind: "you", title: "Check it and file it", note: "Check the amount and supplier before it goes anywhere near accounts." },
      ],
    },
  ];

  const ins = db.prepare(`INSERT INTO workflows (id, name, purpose, steps, trigger, at_time, weekday, builtin, active, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`);
  for (const w of list) ins.run(newId(), w.name, w.purpose, JSON.stringify(w.steps), w.trigger, w.at_time, w.weekday ?? null, now(), now());
  return list.length;
}
