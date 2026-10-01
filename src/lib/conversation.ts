import { getDb, getSetting, setSetting, newId, now } from "@/lib/db";
import { fetchUrl } from "@/lib/sources";
import { getCompetitors } from "@/lib/sources";
import { googleNews, trendsIndia, redditThreads, type Signal } from "@/lib/research";
import { searchAds, adText, getMetaToken, igCompetitorPosts, type IgAccount } from "@/lib/meta";
import { getBrandProfile } from "@/lib/brandsite";
import { FORMATS } from "@/lib/slots";

/* "Conversation": what people are actually searching, asking and engaging with, gathered for a
   month so Claude can turn it into topic ideas on the calendar. Every source here is public or
   the user's own official API access. Instagram comments, LinkedIn and "People also ask" have no
   open access, so Claude covers those with web search when it writes the ideas. */

export type Suggest = { seed: string; suggestions: string[] };
export type Conversation = {
  month: string; gathered_at: string; seeds: string[];
  google: Suggest[]; youtube: Suggest[]; news: Signal[]; reddit: Signal[]; trends: Signal[];
  meta_ads: { competitor: string; page: string; text: string; started: string; link: string }[];
  instagram: IgAccount[]; errors: string[];
};

const DEFAULT_SEEDS = ["electric motorcycle", "electric bike india", "ev charging", "electric scooter"];
const QUESTION_WORDS = ["why", "how", "is", "vs", "best", "cost of"];

async function suggest(q: string, yt = false): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=in${yt ? "&ds=yt" : ""}&q=${encodeURIComponent(q)}`;
  const r = await fetchUrl(url, { accept: "application/json", maxBytes: 200_000, timeoutMs: 8000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = JSON.parse(r.buffer.toString("utf8")) as [string, string[]];
  return (body[1] || []).filter((s) => s.toLowerCase() !== q.toLowerCase());
}

export function conversationSeeds() {
  const profile = getBrandProfile();
  const kw = (profile?.keywords || []).map((k) => k.trim()).filter(Boolean);
  return Array.from(new Set([...kw, ...DEFAULT_SEEDS])).slice(0, 5);
}

export async function gatherConversation(month: string): Promise<Conversation> {
  const errors: string[] = [];
  const seeds = conversationSeeds();
  const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T) => {
    try { return await fn(); } catch (e) { errors.push(`${label}: ${(e as Error).message}`); return fallback; }
  };

  // questions people type: question words on the top two seeds, plain completions on the rest
  const googleQueries = [...seeds.slice(0, 2).flatMap((s) => QUESTION_WORDS.map((w) => `${w} ${s}`)), ...seeds];
  // question words often echo the same completions; keep each suggestion once
  const seenG = new Set<string>();
  const google: Suggest[] = [];
  for (const q of googleQueries) {
    const s = (await safe(`Google suggestions (${q})`, () => suggest(q), [] as string[])).filter((x) => !seenG.has(x.toLowerCase()));
    s.forEach((x) => seenG.add(x.toLowerCase()));
    if (s.length) google.push({ seed: q, suggestions: s.slice(0, 8) });
  }
  const seenY = new Set<string>();
  const youtube: Suggest[] = [];
  for (const q of seeds) {
    const s = (await safe(`YouTube suggestions (${q})`, () => suggest(q, true), [] as string[])).filter((x) => !seenY.has(x.toLowerCase()));
    s.forEach((x) => seenY.add(x.toLowerCase()));
    if (s.length) youtube.push({ seed: q, suggestions: s.slice(0, 8) });
  }

  const [news, trends] = await Promise.all([
    safe("News", () => googleNews(`(${seeds.slice(0, 3).map((s) => `"${s}"`).join(" OR ")}) India when:30d`, 12), [] as Signal[]),
    safe("Google Trends", trendsIndia, [] as Signal[]),
  ]);
  // Reddit rate-limits bursts, so one seed at a time
  const reddit: Signal[] = [];
  for (const s of seeds.slice(0, 2)) {
    const r = await safe(`Reddit (${s})`, () => redditThreads(s), [] as Signal[]);
    for (const x of r) if (!reddit.some((y) => y.link === x.link)) reddit.push(x);
  }

  const competitors = getCompetitors();
  const meta_ads: Conversation["meta_ads"] = [];
  if (getMetaToken()) {
    for (const c of competitors.slice(0, 5)) {
      const res = await safe(`Meta ads (${c.name})`, () => searchAds({ terms: c.name, country: "IN", activeOnly: true, limit: 5 }), { ads: [], after: "", country: "IN" });
      for (const a of res.ads) meta_ads.push({ competitor: c.name, page: a.page_name || "", text: adText(a).slice(0, 300), started: (a.ad_delivery_start_time || "").slice(0, 10), link: a.ad_snapshot_url || "" });
    }
  }
  const instagram: IgAccount[] = [];
  if (getMetaToken() && getSetting("ig_user_id")) {
    for (const c of competitors.filter((x) => x.instagram).slice(0, 6)) {
      const acc = await safe(`Instagram (@${c.instagram})`, () => igCompetitorPosts(c.instagram), null);
      if (acc) instagram.push(acc);
    }
  }

  return { month, gathered_at: now(), seeds, google, youtube, news, reddit, trends, meta_ads, instagram, errors };
}

export function getConversation(month: string): Conversation | null {
  try { return JSON.parse(getSetting(`conversation_${month}`) || "null"); } catch { return null; }
}

/* Posts in the month (from today) that have no topic and no ideas yet. */
export function slotsNeedingIdeas(month: string) {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const rows = getDb().prepare("SELECT id, research FROM slots WHERE date LIKE ? AND date >= ? AND TRIM(topic) = '' AND status != 'posted'").all(`${month}-%`, today) as { id: string; research: string }[];
  return rows.filter((r) => {
    try { const x = JSON.parse(r.research || "{}"); return !(Array.isArray(x.topic_ideas) && x.topic_ideas.length); } catch { return true; }
  }).map((r) => r.id);
}

export function ideasJob(month: string) {
  return getDb().prepare("SELECT id, status, error, created_at, updated_at FROM research_jobs WHERE kind = 'ideas' AND payload LIKE ? ORDER BY created_at DESC LIMIT 1").get(`%"month":"${month}"%`) as
    { id: string; status: string; error: string; created_at: string; updated_at: string } | undefined;
}

/* Gathers the month's conversation and queues one Claude job to turn it into ideas for every
   open post. Does nothing when there's nothing to fill or a job is already waiting. */
const inFlight = new Map<string, Promise<unknown>>();
export async function queueMonthIdeas(month: string, force = false) {
  // two calls for the same month at once (two tabs, dev double-render) share one gathering
  const running = inFlight.get(month);
  if (running) { await running.catch(() => null); return { queued: false, reason: "already_queued" }; }
  const work = queueMonthIdeasNow(month, force);
  inFlight.set(month, work);
  try { return await work; } finally { inFlight.delete(month); }
}

async function queueMonthIdeasNow(month: string, force: boolean) {
  const open = ideasJob(month);
  if (open && (open.status === "queued" || open.status === "running")) return { queued: false, reason: "already_queued", job_id: open.id };
  const need = slotsNeedingIdeas(month);
  if (!need.length && !force) return { queued: false, reason: "nothing_to_fill" };
  const existing = getConversation(month);
  const fresh = existing && Date.now() - new Date(existing.gathered_at).getTime() < 24 * 3600 * 1000;
  const convo = fresh && !force ? existing : await gatherConversation(month);
  setSetting(`conversation_${month}`, JSON.stringify(convo));
  const id = newId();
  getDb().prepare("INSERT INTO research_jobs (id, slot_id, kind, status, payload, created_at, updated_at) VALUES (?, '', 'ideas', 'queued', ?, ?, ?)")
    .run(id, JSON.stringify({ month }), now(), now());
  return { queued: true, job_id: id, slots: need.length, errors: convo!.errors };
}

export type Idea = { topic?: string; format?: string; hook?: string; why?: string; conversation?: string; keywords?: string[] };

export function cleanIdeas(ideas: Idea[] | undefined) {
  return (ideas || []).filter((i) => i?.topic?.trim()).slice(0, 5).map((i) => ({
    topic: i.topic!.trim(),
    format: FORMATS.includes(i.format as (typeof FORMATS)[number]) ? i.format! : "image",
    hook: (i.hook || "").trim(),
    why: (i.why || "").trim(),
    conversation: (i.conversation || "").trim(),
    keywords: (Array.isArray(i.keywords) ? i.keywords : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 8),
  }));
}

