import { getDb, newId, now, getSetting, setSetting } from "@/lib/db";
import { runChatGptJson } from "@/lib/chatgpt";
import { remember, knowledgeBrief, type Incoming } from "@/lib/knowledge";

/* The morning intelligence sweep for the whole Nemi / BNC group, run inside Circuit.

   This is the daily intel that used to happen in a chat window: ten verticals, scored, with a
   readable brief and an archive that compounds. Two things change by living here — it runs on
   a schedule without anyone asking, and what it finds lands in the same knowledge store the
   content pipeline already reads from, so a policy change found on Monday is in Tuesday's
   topic ideas without a person carrying it across.

   Every run is kept as a dated archive entry, so trends can be read back over months. */

export const VERTICALS = [
  { n: 1, name: "EV and automobile", entity: "BNC Motors", focus: "electric two-wheelers, the auto industry, mobility" },
  { n: 2, name: "Manufacturing", entity: "BMPL / Booma Manufacturing", focus: "precision engineering, tooling, contract manufacturing" },
  { n: 3, name: "Electrical and electronics", entity: "Booma Energy / Nemi Power", focus: "BMS, chargers, IoT, storage, power electronics" },
  { n: 4, name: "B2B fleet and 3PL", entity: "Booma Motors", focus: "fleet leasing, logistics, last-mile, B2B EV" },
  { n: 5, name: "Physical and manufacturing AI", entity: "Nemi AI", focus: "AI in factories, robotics, machine vision" },
  { n: 6, name: "Mergers and funding", entity: "group-wide", focus: "acquisitions and funding in the US, China, Middle East, Europe" },
  { n: 7, name: "Manufacturing AI technology", entity: "group-wide", focus: "digital twins, predictive maintenance, generative AI for manufacturing" },
  { n: 8, name: "India trade", entity: "group-wide", focus: "tariffs, customs, PLI, BIS standards, import and export policy" },
  { n: 9, name: "India money and tax", entity: "group-wide", focus: "GST, incentives, FAME and PM E-DRIVE, RBI policy, funding" },
  { n: 10, name: "Headwinds and tailwinds", entity: "group-wide", focus: "macro risks and openings across all of the above" },
];

export type IntelItem = {
  vertical: string; headline: string; what: string; why: string; action: string;
  score: number; impact: string; source_name: string; source_url: string; dated: string;
};
export type IntelRun = {
  id: string; date: string; theme: string; summary: string;
  items: IntelItem[]; filed: { added: number; seen_again: number; dropped: number } | null; seconds: number;
};

const IMPACTS = ["direct impact", "what to expect", "worth knowing", "good to be aware"];

export function lastIntel(): { at: string; date: string; items: number } | null {
  try { return JSON.parse(getSetting("intel_last") || "null"); } catch { return null; }
}

export function intelDue() {
  const last = lastIntel();
  if (!last) return true;
  return last.date !== new Date().toISOString().slice(0, 10);
}

export function intelArchive(limit = 30) {
  return getDb().prepare("SELECT id, title, tags, notes, created_at FROM documents WHERE kind = 'intel' ORDER BY created_at DESC LIMIT ?").all(limit) as
    { id: string; title: string; tags: string; notes: string; created_at: string }[];
}
export function intelEntry(id: string) {
  return getDb().prepare("SELECT * FROM documents WHERE id = ? AND kind = 'intel'").get(id) as
    { id: string; title: string; text: string; notes: string; created_at: string } | undefined;
}

/* One morning's sweep. Scores below 4 are dropped by the model before we ever see them. */
export async function runIntel(): Promise<IntelRun> {
  const started = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const recent = intelArchive(14).map((a) => a.title);

  const prompt = `You are the intelligence analyst for the Nemi AI / BNC group in Coimbatore, India. Produce this morning's briefing for ${date}.

Search the web across these ten verticals, roughly two to three searches each, covering the last 24 hours (or since the last run if there is a gap):
${VERTICALS.map((v) => `${v.n}. ${v.name} — for ${v.entity}: ${v.focus}`).join("\n")}

Then:
- Score every item 1-10 for how much it matters to this group. Drop anything below 4; keep the best 12 to 20 overall.
- Give each an impact label, exactly one of: ${IMPACTS.join(", ")}.
- Say what happened, why it matters to this group specifically, and what to do about it — each in one or two plain sentences. "what to do" may be "nothing yet, watch it".
- Name the single biggest theme of the day in one line.
- Prefer a primary source — a ministry page, a company announcement, an exchange filing, an industry body — over a blog repeating it. Every item needs a real source_url you actually read.
- Do not repeat what these recent briefings already said unless it has genuinely moved: ${JSON.stringify(recent).slice(0, 1200)}
- Do not invent numbers. If a figure is provisional or disputed, say so in "what".

Return ONLY one JSON object, no commentary and no code fence:
{"theme":"the day in one line","summary":"3-5 sentences a busy founder can read in twenty seconds","items":[{"vertical":"one of the ten names above","headline":"","what":"","why":"","action":"","score":7,"impact":"one of the four labels","source_name":"","source_url":"","dated":"YYYY-MM-DD"}]}`;

  const answer = (await runChatGptJson(prompt, { search: true, timeoutMs: 20 * 60 * 1000 })) as {
    theme?: string; summary?: string; items?: IntelItem[];
  };

  const items = (answer.items || [])
    .filter((i) => i?.headline && /^https?:\/\//i.test(i.source_url || ""))
    .map((i) => ({ ...i, score: Math.max(1, Math.min(10, Number(i.score) || 5)), impact: IMPACTS.includes((i.impact || "").toLowerCase()) ? i.impact.toLowerCase() : "worth knowing" }))
    .sort((a, b) => b.score - a.score);

  /* Anything scoring 7 or more is worth the content pipeline knowing about, so it goes into the
     same store the topic ideas read from. The rest stays in the briefing only. */
  const forKnowledge: Incoming[] = items.filter((i) => i.score >= 7).map((i) => ({
    kind: /policy|tax|trade|money/i.test(i.vertical) ? "policy" : /fleet|ev|automobile/i.test(i.vertical) ? "market" : /merger|funding/i.test(i.vertical) ? "market" : "trend",
    title: i.headline, body: i.what, why: i.why,
    source_name: i.source_name, source_url: i.source_url, dated: i.dated,
    confidence: i.score >= 9 ? "high" : "medium", tags: [i.vertical],
  }));
  const filed = forKnowledge.length ? remember(forKnowledge, "Daily intel") : null;

  const id = newId();
  const markdown = toMarkdown(date, answer.theme || "", answer.summary || "", items);
  getDb().prepare("INSERT INTO documents (id, title, kind, tags, notes, text, file_id, created_at, updated_at) VALUES (?, ?, 'intel', ?, ?, ?, NULL, ?, ?)")
    .run(id, `Daily intel ${date}`, items.map((i) => i.vertical).filter((v, n, a) => a.indexOf(v) === n).join(", ").slice(0, 200),
      (answer.theme || "").slice(0, 300), markdown, now(), now());

  const seconds = Math.round((Date.now() - started) / 1000);
  setSetting("intel_last", JSON.stringify({ at: now(), date, items: items.length }));
  return { id, date, theme: answer.theme || "", summary: answer.summary || "", items, filed, seconds };
}

/* The archive entry: the same briefing as plain text, so it can be read back, searched and
   sent in an email without any of this code being involved. */
function toMarkdown(date: string, theme: string, summary: string, items: IntelItem[]) {
  const byImpact = IMPACTS.map((label) => ({ label, list: items.filter((i) => i.impact === label) })).filter((g) => g.list.length);
  return [
    `# Daily intel — ${date}`,
    ``,
    `**Today's theme:** ${theme}`,
    ``,
    summary,
    ``,
    ...byImpact.flatMap((g) => [
      `## ${g.label.replace(/\b\w/g, (c) => c.toUpperCase())}`,
      ``,
      ...g.list.flatMap((i) => [
        `### ${i.headline}  · ${i.score}/10`,
        `*${i.vertical}${i.dated ? ` · ${i.dated}` : ""}*`,
        ``,
        i.what,
        ``,
        `**Why it matters:** ${i.why}`,
        `**What to do:** ${i.action}`,
        `**Source:** ${i.source_name} — ${i.source_url}`,
        ``,
      ]),
    ]),
    `---`,
    `Circuit gathered this on ${new Date().toISOString()}. ${items.length} items kept. Anything scoring 7 or more has gone into what Circuit knows, so it reaches the content plan too.`,
  ].join("\n");
}

/* The briefing as an email body, short enough to read on a phone. */
export function intelEmail(run: { date: string; theme: string; summary: string; items: IntelItem[] }) {
  const top = run.items.slice(0, 8);
  const subject = `Daily intel ${run.date} — ${run.theme || `${run.items.length} items`}`.slice(0, 140);
  const lines = [
    run.theme ? `Today: ${run.theme}` : "",
    "",
    run.summary,
    "",
    ...top.flatMap((i) => [
      `${i.score}/10 · ${i.impact.toUpperCase()} · ${i.vertical}`,
      i.headline,
      i.what,
      `Why: ${i.why}`,
      `Do: ${i.action}`,
      i.source_url,
      "",
    ]),
    run.items.length > top.length ? `${run.items.length - top.length} more in Circuit.` : "",
    "",
    `Knowledge and the full briefing: http://localhost:3210/intel`,
  ].filter((l) => l !== undefined);
  return { subject, body: lines.join("\n") };
}

export function knowledgeForIntel() {
  return knowledgeBrief(10);
}
