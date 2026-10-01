import fs from "node:fs";
import path from "node:path";
import { getDb, newId, now } from "@/lib/db";
import { runChatGptJson } from "@/lib/chatgpt";
import { healthReport } from "@/lib/health";

/* What Circuit thinks it should become next.

   The app already holds its own specification: docs/PRD.html lists every requirement with an
   acceptance test, and most of the work left is sitting there unbuilt. It also knows what is
   broken, from its own health checks and its failed jobs. This reads both, and asks for the
   three pieces of work worth doing next — with a plan concrete enough to hand to whoever
   writes the code.

   It stops at the plan on purpose. Circuit proposes; a person decides; the code is written in
   a session with a human watching. An app that edits itself unattended eventually ships
   something that compiles and quietly ruins a month of work. */

const ROOT = process.cwd();

export type Item = {
  id: string; title: string; why: string; kind: string; requirement: string;
  plan: string; files: string; risk: string; acceptance: string; effort: string;
  status: "proposed" | "next" | "doing" | "done" | "dropped"; notes: string;
  created_at: string; updated_at: string;
};

export function listRoadmap(): Item[] {
  return getDb().prepare("SELECT * FROM roadmap ORDER BY (status = 'doing') DESC, (status = 'next') DESC, created_at DESC").all() as Item[];
}

export function setStatus(id: string, status: Item["status"], notes?: string) {
  getDb().prepare("UPDATE roadmap SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?")
    .run(status, notes ?? null, now(), id);
  return getDb().prepare("SELECT * FROM roadmap WHERE id = ?").get(id) as Item;
}

/* Everything the app can say about its own state, in one object. */
export async function selfPicture() {
  const prdPath = path.join(ROOT, "docs/PRD.html");
  const prd = fs.existsSync(prdPath) ? fs.readFileSync(prdPath, "utf8") : "";
  const rows = Array.from(prd.matchAll(/<tr><td class="id">([A-Z]{2}-\d+)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td><span class="chip (\w+)">/g));
  const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const all = rows.map((m) => ({ id: m[1], requirement: strip(m[2]), acceptance: strip(m[3]), state: m[4] }));
  const unbuilt = all.filter((r) => !["built", "pass"].includes(r.state));

  const health = await healthReport().catch(() => ({ checks: [] as { label: string; state: string; detail: string }[] }));
  const db = getDb();
  return {
    built: all.length - unbuilt.length,
    unbuilt,
    problems: health.checks.filter((c) => c.state !== "ok").map((c) => `${c.label}: ${c.detail}`),
    failed_jobs: db.prepare("SELECT kind, substr(error, 1, 160) error FROM research_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 5").all(),
    already_on_the_board: (db.prepare("SELECT title, requirement, status FROM roadmap WHERE status != 'dropped'").all() as { title: string; requirement: string; status: string }[]),
    size: {
      posts: (db.prepare("SELECT COUNT(*) n FROM slots").get() as { n: number }).n,
      knowledge: (db.prepare("SELECT COUNT(*) n FROM knowledge WHERE status = 'live'").get() as { n: number }).n,
      own_posts: (db.prepare("SELECT COUNT(*) n FROM own_posts").get() as { n: number }).n,
      workflows: (db.prepare("SELECT COUNT(*) n FROM workflows").get() as { n: number }).n,
    },
  };
}

export async function proposeNext(count = 3): Promise<Item[]> {
  const me = await selfPicture();
  const prompt = `You are the engineer who looks after Circuit, a local Next.js 15 (App Router) + TypeScript + better-sqlite3 marketing app used by one person at an Indian electric two-wheeler company. Everything runs on their Mac: ChatGPT through the Codex CLI does the writing and the pictures, Meta's API reads Instagram, and there is no hosting and no team.

Choose the ${count} pieces of work worth doing next.

Judge by what the owner would feel using the app tomorrow. Prefer:
- fixing something that is actually broken over adding anything
- finishing something half-built over starting something new
- work that stands alone, over work waiting on a platform review, a paid API or a credential the app does not have

Skip anything marked "gated" unless the app clearly already has what it needs. Do not propose anything already on the board.

Write each plan so that an engineer could start without asking a question: name real files under src/, say what changes in each, and give one plain check that proves it worked. Be honest in "risk" about what could break.

What the app looks like right now:
${JSON.stringify(me).slice(0, 45000)}

Return ONLY one JSON object, no commentary and no code fence:
{"reading":"2-4 sentences on the state of the app, plainly","items":[{"requirement":"the PRD id, or empty for a defect","title":"short and plain","why":"one line: what the owner gets","kind":"fix|feature|polish","effort":"small|medium|large","plan":"the steps, naming files under src/","files":["src/..."],"risk":"what could break","acceptance":"one line: how to know it worked"}]}`;

  const answer = (await runChatGptJson(prompt, { search: false, timeoutMs: 10 * 60 * 1000 })) as {
    reading?: string;
    items?: { requirement?: string; title?: string; why?: string; kind?: string; effort?: string; plan?: string; files?: string[]; risk?: string; acceptance?: string }[];
  };

  const db = getDb();
  const ins = db.prepare(`INSERT INTO roadmap (id, title, why, kind, requirement, plan, files, risk, acceptance, effort, status, notes, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`);
  const made: string[] = [];
  for (const t of (answer.items || []).slice(0, count)) {
    if (!t.title?.trim() || !t.plan?.trim()) continue;
    const id = newId();
    ins.run(id, t.title.trim().slice(0, 140), (t.why || "").slice(0, 300), t.kind || "feature", (t.requirement || "").slice(0, 20),
      t.plan.slice(0, 5000), JSON.stringify(t.files || []), (t.risk || "").slice(0, 400), (t.acceptance || "").slice(0, 300),
      t.effort || "", (answer.reading || "").slice(0, 600), now(), now());
    made.push(id);
  }
  return made.map((id) => db.prepare("SELECT * FROM roadmap WHERE id = ?").get(id) as Item);
}

/* The plan, as something you can hand straight to a developer session. */
export function handoff(id: string) {
  const t = getDb().prepare("SELECT * FROM roadmap WHERE id = ?").get(id) as Item | undefined;
  if (!t) throw new Error("Not on the board");
  let files: string[] = [];
  try { files = JSON.parse(t.files || "[]"); } catch { files = []; }
  return [
    `Build this in Circuit (~/Desktop/MarkENGG).`,
    ``,
    `${t.title}${t.requirement ? ` — ${t.requirement} in docs/PRD.html` : ""}`,
    t.why ? `Why: ${t.why}` : "",
    ``,
    `Plan:`,
    t.plan,
    files.length ? `\nFiles: ${files.join(", ")}` : "",
    t.risk ? `\nWatch out for: ${t.risk}` : "",
    t.acceptance ? `\nDone when: ${t.acceptance}` : "",
    ``,
    `House rules: match the surrounding code and its plain-English comments, no new dependencies, keep tsc --noEmit clean, and never touch data/.`,
  ].filter((x) => x !== "").join("\n");
}
