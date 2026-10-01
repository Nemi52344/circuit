import { getDb, newId, now } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { getBrandProfile } from "@/lib/brandsite";
import { runChatGptJson } from "@/lib/chatgpt";
import { learned } from "@/lib/learn";
import { posterLearned } from "@/lib/posterlearn";
import { lastIgSync } from "@/lib/igsync";
import { remember, knowledgeBrief, knowledgeCounts, type Incoming } from "@/lib/knowledge";

/* An agent is one job you would otherwise do yourself, written down once.

   It has a name, what it is for, the instruction, and which of Circuit's own knowledge it
   should be handed before it starts — the brand, what has worked, this month's plan, the
   brochures. Circuit runs it on the owner's own ChatGPT sign-in, read-only, and keeps the
   answer. Agents are the pieces; workflows chain them together. */

export type ContextKey = "brand" | "results" | "posters" | "plan" | "competitors" | "documents" | "knowledge";
export type Agent = {
  id: string; name: string; purpose: string; prompt: string; shape: string;
  search: number; context: string; builtin: number; active: number; created_at: string; updated_at: string;
};

export const CONTEXT_LABEL: Record<ContextKey, string> = {
  brand: "The brand and who it sells to",
  results: "What has worked for us",
  posters: "What works in our pictures",
  plan: "This month's posts",
  competitors: "Competitors and their last posts",
  documents: "Brochures and documents",
  knowledge: "What Circuit has learned so far",
};

export function listAgents(): Agent[] {
  return getDb().prepare("SELECT * FROM agents ORDER BY builtin DESC, name").all() as Agent[];
}
export function getAgent(id: string): Agent | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent | undefined;
}

export function saveAgent(a: Partial<Agent> & { name: string }) {
  const db = getDb();
  if (a.id) {
    db.prepare(`UPDATE agents SET name = ?, purpose = ?, prompt = ?, shape = ?, search = ?, context = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(a.name, a.purpose || "", a.prompt || "", a.shape || "", a.search ?? 1, a.context || "[]", a.active ?? 1, now(), a.id);
    return getAgent(a.id)!;
  }
  const id = newId();
  db.prepare(`INSERT INTO agents (id, name, purpose, prompt, shape, search, context, builtin, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`)
    .run(id, a.name, a.purpose || "", a.prompt || "", a.shape || "", a.search ?? 1, a.context || "[]", now(), now());
  return getAgent(id)!;
}

export function deleteAgent(id: string) {
  getDb().prepare("DELETE FROM agents WHERE id = ? AND builtin = 0").run(id);
}

/* Only what the agent asked for is handed over, so a small job doesn't carry the whole app. */
export function buildContext(keys: ContextKey[]): Record<string, unknown> {
  const db = getDb();
  const out: Record<string, unknown> = {};
  if (keys.includes("brand")) {
    const b = getBrand();
    out.brand = { name: b.name, tagline: b.tagline, tone: b.tone, audience: b.audience, claims: b.claims };
    out.profile = getBrandProfile();
  }
  if (keys.includes("results")) {
    const l = learned();
    out.results = { headline: l.headline, advice: l.advice, formats: l.own_formats, days: l.own_weekdays, standouts: l.own_standouts };
  }
  if (keys.includes("posters")) {
    const p = posterLearned();
    out.posters = { advice: p.advice, best: p.best.map((b) => ({ subject: b.subject, times: b.times, text_on_image: b.text_on_image })) };
  }
  if (keys.includes("plan")) {
    out.plan = db.prepare(`SELECT s.date, s.topic, s.format, s.status, s.stage, p.name pillar
                           FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id
                           WHERE s.date >= date('now','-7 day') ORDER BY s.date LIMIT 40`).all();
  }
  if (keys.includes("competitors")) {
    out.competitors = db.prepare("SELECT competitor, title, notes, created_at FROM inspirations WHERE origin LIKE 'ig:%' ORDER BY created_at DESC LIMIT 20").all();
    out.last_competitor_check = lastIgSync();
  }
  if (keys.includes("knowledge")) {
    out.already_known = knowledgeBrief(30);
    out.knowledge_counts = knowledgeCounts();
  }
  if (keys.includes("documents")) {
    out.documents = db.prepare("SELECT title, kind, tags, notes, substr(text, 1, 4000) text FROM documents ORDER BY created_at DESC LIMIT 12").all();
  }
  return out;
}

export type AgentResult = { ok: boolean; answer: unknown; text: string; seconds: number; error: string; filed?: { added: number; seen_again: number; dropped: number } };

/* One run: the instruction, the context it asked for, and a JSON answer back. */
export async function runAgent(agent: Agent, extra?: Record<string, unknown>): Promise<AgentResult> {
  const started = Date.now();
  let keys: ContextKey[] = [];
  try { keys = JSON.parse(agent.context || "[]"); } catch { keys = []; }
  const context = buildContext(keys);
  const shape = agent.shape.trim() || `{"summary":"what you found, in plain sentences","points":["the things worth knowing"],"next":["what should be done, or empty"]}`;
  const prompt = [
    `You are "${agent.name}", an agent inside Circuit, a marketing app for ${getBrand().name}.`,
    agent.purpose ? `What you are for: ${agent.purpose}` : "",
    agent.prompt,
    "Rules:",
    "- Only state facts you found in the data given or in sources you searched. Never invent product numbers; write [check spec sheet] instead.",
    "- If your answer has a \"findings\" list, every entry MUST carry a real source_url you actually read. An entry without one is thrown away, so do not pad the list.",
    "- Do not repeat something already in what Circuit knows unless it has genuinely changed; say what changed.",
    "- Plain text in every field. No markdown, no emoji.",
    "- Return ONLY one JSON object, no commentary and no code fence.",
    `JSON shape: ${shape}`,
    Object.keys(context).length ? `What Circuit knows:\n${JSON.stringify(context).slice(0, 60000)}` : "",
    extra && Object.keys(extra).length ? `For this run:\n${JSON.stringify(extra).slice(0, 20000)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const answer = await runChatGptJson(prompt, { search: agent.search !== 0, timeoutMs: 10 * 60 * 1000 });
    // an agent that returns "findings" is filing them, not just saying them
    const found = (answer as { findings?: Incoming[] })?.findings;
    const filed = Array.isArray(found) && found.length ? remember(found, agent.name) : undefined;
    return { ok: true, answer, text: JSON.stringify(answer), seconds: Math.round((Date.now() - started) / 100) / 10, error: "", filed };
  } catch (e) {
    return { ok: false, answer: null, text: "", seconds: Math.round((Date.now() - started) / 100) / 10, error: (e as Error).message };
  }
}

/* The agents Circuit ships with. They are ordinary agents: editable, and the owner can add
   their own beside them. Seeded once. */
const BUILTIN: { name: string; purpose: string; prompt: string; shape: string; context: ContextKey[]; search: number }[] = [
  {
    name: "Morning marketing check",
    purpose: "Says what needs attention today, in one short read",
    prompt: "Look at this month's posts, what has worked for us and what competitors posted recently. Say what needs doing today and what is worth knowing. Be brief and specific; name dates and post topics.",
    shape: `{"today":"2-4 sentences on what matters today","needs_you":["things only a person can do"],"worth_knowing":["short notes on competitors or results"],"nothing_urgent":false}`,
    context: ["plan", "results", "competitors"], search: 0,
  },
  {
    name: "Competitor watch",
    purpose: "Reads what competitors published and what it means for us",
    prompt: "Read the competitors' recent posts in the data. Say what they are pushing right now, what is working for them, and one thing we should do differently. Search the web for anything major they announced in the last week.",
    shape: `{"summary":"3-5 sentences","themes":["what they are pushing"],"doing_well":["posts that stood out and why"],"for_us":["2-4 concrete suggestions"]}`,
    context: ["competitors", "brand"], search: 1,
  },
  {
    name: "Weekly performance note",
    purpose: "Turns the week's numbers into plain conclusions",
    prompt: "Using our own results and what works in our pictures, write the week's note: what did well, what did not, and what to change next week. Do not call anything a pattern unless the data given says it is solid.",
    shape: `{"headline":"one line","did_well":["with the numbers"],"did_not":["with the numbers"],"change_next_week":["2-4 changes"]}`,
    context: ["results", "posters", "plan"], search: 0,
  },
  {
    name: "Market watch",
    purpose: "Goes looking for what changed in the Indian electric two-wheeler market",
    prompt: "Search the web for what has changed in the last 14 days for electric two-wheelers in India: subsidy and policy changes (PM E-DRIVE, FAME, state schemes, road tax, GST), safety and homologation rules, charging infrastructure, battery supply and prices, and category sales numbers. Prefer primary sources — a ministry page, a company announcement, an industry body — over a blog repeating them. Skip anything already in what Circuit knows unless it has moved.",
    shape: `{"summary":"3-5 sentences on the state of play","findings":[{"kind":"policy|competitor|market|audience|product|trend|risk","title":"the fact in one line","body":"2-3 sentences of detail","why":"why it matters to BNC, one line","source_name":"publication or site","source_url":"the page you read","dated":"YYYY-MM-DD if known","confidence":"high|medium|low","tags":["2-4 short tags"]}]}`,
    context: ["brand", "knowledge"], search: 1,
  },
  {
    name: "Competitor moves",
    purpose: "Watches what Ola, Ather, TVS, Bajaj, Revolt and Ultraviolette actually do",
    prompt: "Search for what each competitor in the data has done in the last 14 days: launches, price changes, offers, recalls, expansion, campaigns and anything they are pushing hard. Say plainly when a competitor has done nothing worth noting rather than filling space.",
    shape: `{"summary":"3-5 sentences","findings":[{"kind":"policy|competitor|market|audience|product|trend|risk","title":"the fact in one line","body":"2-3 sentences of detail","why":"why it matters to BNC, one line","source_name":"publication or site","source_url":"the page you read","dated":"YYYY-MM-DD if known","confidence":"high|medium|low","tags":["2-4 short tags"]}]}`,
    context: ["competitors", "brand", "knowledge"], search: 1,
  },
  {
    name: "Rider listening",
    purpose: "Collects what riders complain about, ask and search, in their own words",
    prompt: "Search forums, Reddit, YouTube comments, Quora and reviews for what Indian electric two-wheeler riders and would-be buyers are saying right now: the complaints, the questions before buying, the words they use for problems. Quote their phrasing rather than tidying it into marketing language.",
    shape: `{"summary":"3-5 sentences","findings":[{"kind":"policy|competitor|market|audience|product|trend|risk","title":"the fact in one line","body":"2-3 sentences of detail","why":"why it matters to BNC, one line","source_name":"publication or site","source_url":"the page you read","dated":"YYYY-MM-DD if known","confidence":"high|medium|low","tags":["2-4 short tags"]}]}`,
    context: ["brand", "knowledge"], search: 1,
  },
  {
    name: "Bill reader",
    purpose: "Reads an invoice or bill and pulls out what matters",
    prompt: "The text of a bill or invoice is given for this run. Pull out the supplier, the amount, the tax, the date, the invoice number and what it was for. If a field is not in the text, leave it empty rather than guessing.",
    shape: `{"supplier":"","invoice_number":"","date":"","amount":"","tax":"","currency":"","what_for":"","confidence":"high|medium|low","missing":["fields you could not find"]}`,
    context: [], search: 0,
  },
];

export function seedAgents() {
  const db = getDb();
  const have = (db.prepare("SELECT COUNT(*) n FROM agents WHERE builtin = 1").get() as { n: number }).n;
  if (have) return 0;
  const ins = db.prepare(`INSERT INTO agents (id, name, purpose, prompt, shape, search, context, builtin, active, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`);
  for (const a of BUILTIN) ins.run(newId(), a.name, a.purpose, a.prompt, a.shape, a.search, JSON.stringify(a.context), now(), now());
  return BUILTIN.length;
}
