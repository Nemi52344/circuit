import { getDb, newId, now } from "@/lib/db";
import { fetchUrl, decode, stripTags } from "@/lib/sources";
import { getCompetitors } from "@/lib/sources";

/* Stage 2 runs by itself. Layer one, here: public feeds read the moment a topic is set
   (Google News, competitor news, Reddit, Google Trends India). Layer two: a research job that
   a Claude session drains, which reads these signals, searches further and writes the analysis
   and angle options back through /api/research/deliver. No API keys anywhere. */

const UA = "Circuit/1.0 (local marketing workspace; contact: the owner of this install)";
export type Signal = { title: string; link: string; source: string; date: string; note?: string };
export type Signals = { gathered_at: string; query: string; topic_news: Signal[]; competitor_news: Signal[]; reddit: Signal[]; trends: Signal[]; searches: Signal[]; errors: string[] };

// "electric" alone pulls in cars; only these words mean the topic is already about two-wheelers
const TWO_WHEELER = /\b(e-?scooters?|scooters?|motorcycles?|motorbikes?|bikes?|two[- ]wheelers?|2w)\b/i;
const RELEVANT_TREND = /(ev|electric|scooter|motorcycle|bike|two[- ]wheeler|petrol|diesel|fuel|traffic|monsoon|rain|battery|ola|ather|tvs|bajaj|hero|revolt|auto|vehicle|road|highway|subsidy|fame|pm e-drive)/i;

async function rss(url: string) {
  const r = await fetchUrl(url, { ua: UA, accept: "application/rss+xml, application/xml, text/xml, */*", maxBytes: 3_000_000, timeoutMs: 15000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.buffer.toString("utf8");
}
const tag = (xml: string, t: string) => decode((xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)) || [])[1] || "").trim();

export async function googleNews(query: string, limit: number): Promise<Signal[]> {
  const xml = await rss(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`);
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const seen = new Set<string>();
  const out: Signal[] = [];
  for (const it of items) {
    const source = tag(it, "source");
    // Google appends " - Publisher" to titles; drop it since the source is its own field
    const title = stripTags(tag(it, "title")).replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    const key = title.toLowerCase().slice(0, 60);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const d = tag(it, "pubDate");
    out.push({ title, link: tag(it, "link"), source, date: d ? new Date(d).toISOString().slice(0, 10) : "" });
    if (out.length >= limit) break;
  }
  return out;
}

const STOP = new Set(("a an the vs versus and or of for to in on at with your our my is are be how why what when month months s its it this that from by as about " +
  "after before first minute minutes check explained time day days week weeks year years new best way right get one two three five real really").split(" "));
// words so common in rider subs that they can't carry relevance on their own
const WEAK = new Set("bike bikes ride riding rider riders india indian electric season".split(" "));

/* What people actually type about THIS topic, from Google's and YouTube's own autocomplete.
   This replaced the country-wide trending list, which was never about the topic at hand. */
export async function topicSearches(topic: string): Promise<Signal[]> {
  // autocomplete answers short, natural phrases: a whole headline returns nothing at all,
  // so the topic is cut down to the words someone would actually type
  const words = topic.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return [];
  // "running business vehicle" brings back businesses for sale, so any seed that has drifted
  // away from the category gets it put back
  const strong = words.filter((w) => !WEAK.has(w));
  const category = (seed: string) => (EV_CONTEXT.test(seed) ? seed : `${seed} electric`);
  const seeds = Array.from(new Set([
    category(words.slice(0, 3).join(" ")),
    category(strong.slice(0, 2).join(" ")),
    `${category(strong.slice(0, 2).join(" "))} india`,
    category(strong.slice(0, 3).join(" ")),
  ].map((x) => x.trim()).filter((x) => x.length > 2)));

  const ask = async (q: string, yt: boolean) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=in${yt ? "&ds=yt" : ""}&q=${encodeURIComponent(q)}`;
    const r = await fetchUrl(url, { ua: UA, accept: "application/json", maxBytes: 200_000, timeoutMs: 8000 });
    if (!r.ok) return [];
    const body = JSON.parse(r.buffer.toString("utf8")) as [string, string[]];
    return (body[1] || []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  };

  const out: Signal[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    for (const yt of [false, true]) {
      if (out.length >= 14) break;
      const list = await ask(seed, yt).catch(() => []);
      for (const phrase of list.slice(0, 6)) {
        const key = phrase.toLowerCase();
        if (seen.has(key)) continue;
        // autocomplete drifts: "running business" brings back businesses for sale. Keep a
        // phrase only when it is still about this category and shares a word with the topic
        if (!EV_CONTEXT.test(phrase)) continue;
        if (strong.length && !strong.some((w) => key.includes(w))) continue;
        seen.add(key);
        out.push({
          title: phrase,
          link: yt ? `https://www.youtube.com/results?search_query=${encodeURIComponent(phrase)}` : `https://www.google.com/search?q=${encodeURIComponent(phrase)}`,
          source: yt ? "YouTube search" : "Google search",
          date: new Date().toISOString().slice(0, 10),
          note: `people type this after "${seed}"`,
        });
      }
    }
  }
  return out.slice(0, 14);
}

export async function trendsIndia(): Promise<Signal[]> {
  const xml = await rss("https://trends.google.com/trending/rss?geo=IN");
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items
    .map((it) => ({ title: stripTags(tag(it, "title")), link: `https://trends.google.com/trends/explore?geo=IN&q=${encodeURIComponent(stripTags(tag(it, "title")))}`, source: "Google Trends India", date: new Date().toISOString().slice(0, 10), note: tag(it, "ht:approx_traffic") }))
    .filter((x) => RELEVANT_TREND.test(x.title))
    .slice(0, 6);
}


/* Reddit's global search surfaces viral posts that share a loose word. Searching inside the
   communities Indian riders actually use, by relevance, and keeping only threads that mention
   the topic's own words gives something worth reading. */
const RIDER_SUBS = ["IndianBikes", "electricvehicles", "ElectricScooters", "CarsIndia", "india", "bangalore", "mumbai", "delhi", "pune"];
const EV_CONTEXT = /\b(ev|evs|electric|scooter|motorcycle|bike|two[- ]wheeler|charging|charger|battery|range|kwh)\b/i;
const redditCache = new Map<string, { at: number; items: Signal[] }>();

export async function redditThreads(topic: string): Promise<Signal[]> {
  const terms = topic.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const q = terms.slice(0, 5).join(" ");
  if (!q) return [];
  const url = `https://www.reddit.com/r/${RIDER_SUBS.join("+")}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=1&sort=relevance&t=year&limit=25`;
  const hit = redditCache.get(url);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.items;
  const r = await fetchUrl(url, { ua: UA, accept: "application/atom+xml, application/xml, */*", maxBytes: 3_000_000, timeoutMs: 15000 });
  if (r.status === 429) throw new Error("rate-limited, try again in a few minutes");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = r.buffer.toString("utf8");
  const out: Signal[] = [];
  for (const e of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const title = stripTags(tag(e, "title"));
    const link = decode((e.match(/<link[^>]+href="([^"]+)"/) || [])[1] || "");
    if (!title || !/\/comments\//.test(link)) continue;
    const content = stripTags(tag(e, "content")).replace(/submitted by.*$/i, "").replace(/\[link\]|\[comments\]/g, "").trim();
    const hay = `${title} ${content}`.toLowerCase();
    const has = (text: string, w: string) => new RegExp(`\\b${w}`, "i").test(text);
    // at least two of the topic's words must appear, one of them a strong word in the title,
    // and the thread has to be about bikes or EVs at all (city subs carry plenty of noise)
    const strong = terms.filter((w) => !WEAK.has(w));
    const matched = terms.filter((w) => has(hay, w)).length;
    if (matched < Math.min(2, terms.length)) continue;
    if (strong.length && !strong.some((w) => has(title.toLowerCase(), w))) continue;
    if (!EV_CONTEXT.test(hay)) continue;
    const sub = decode((e.match(/<category[^>]+term="([^"]+)"/) || [])[1] || "");
    out.push({ title, link, source: sub ? `r/${sub}` : "Reddit", date: tag(e, "updated").slice(0, 10), note: content.slice(0, 200) });
    if (out.length >= 8) break;
  }
  redditCache.set(url, { at: Date.now(), items: out });
  return out;
}

export async function gatherSignals(topic: string, pillar: string | null): Promise<Signals> {
  const base = topic.replace(/['’]/g, "").replace(/[:"]/g, " ").replace(/\s+/g, " ").trim();
  const context = TWO_WHEELER.test(base) ? "" : " electric scooter motorcycle";
  const query = `${base}${context} India`;
  const competitors = getCompetitors().map((c) => c.name).filter(Boolean);
  const errors: string[] = [];
  const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch (e) { errors.push(`${label}: ${(e as Error).message}`); return fallback; }
  };

  // every source is scoped to this topic: competitor news is competitors ON this topic, and
  // the search phrases are what people type about it. Nothing country-wide or off-topic.
  const strong = base.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 4);
  const competitorQuery = competitors.length && strong.length
    ? `(${competitors.map((n) => `"${n}"`).join(" OR ")}) (${strong.join(" OR ")}) when:120d`
    : "";
  const [topic_news, competitor_news, reddit, searches] = await Promise.all([
    safe("News", () => googleNews(`${query} when:90d`, 8), []),
    safe("Competitor news", () => (competitorQuery ? googleNews(competitorQuery, 6) : Promise.resolve([])), []),
    safe("Reddit", () => redditThreads(base), []),
    safe("Searches", () => topicSearches(base), []),
  ]);
  return { gathered_at: now(), query: `${query}${pillar ? ` · pillar ${pillar}` : ""}`, topic_news, competitor_news, reddit, trends: [], searches, errors };
}

/* Gathers signals now, stores them on the slot, and queues one analysis job for Claude.
   Re-running replaces a job that hasn't started rather than stacking another. */
export async function startResearch(slotId: string) {
  const db = getDb();
  const slot = db.prepare("SELECT s.id, s.topic, s.research, p.name AS pillar_name FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id WHERE s.id = ?")
    .get(slotId) as { id: string; topic: string; research: string; pillar_name: string | null } | undefined;
  if (!slot) throw new Error("Slot not found");
  if (!slot.topic.trim()) throw new Error("Set a topic first");

  const signals = await gatherSignals(slot.topic, slot.pillar_name);
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
  // a new topic makes the old analysis stale; keep only what the owner typed by hand
  const merged = { ...research, signals, analysed_at: null, angles: [], summary_competitor: "", summary_market: "", summary_trends: "", summary_topic: "", recommended_format: "", sources: [] };
  db.prepare("UPDATE slots SET research = ?, stage = MAX(stage, 2), updated_at = ? WHERE id = ?").run(JSON.stringify(merged), now(), slotId);

  db.prepare("DELETE FROM research_jobs WHERE slot_id = ? AND status = 'queued' AND kind = 'research'").run(slotId);
  const id = newId();
  db.prepare("INSERT INTO research_jobs (id, slot_id, kind, status, created_at, updated_at) VALUES (?, ?, 'research', 'queued', ?, ?)").run(id, slotId, now(), now());
  return { job_id: id, signals };
}

/* Queues Claude to write captions for every platform on the slot, from the chosen angle.
   Drafts land in research.copy_drafts; nothing is saved as final copy until the owner saves it. */
export function startCopy(slotId: string) {
  const db = getDb();
  const slot = db.prepare("SELECT topic, platforms, research FROM slots WHERE id = ?").get(slotId) as { topic: string; platforms: string; research: string } | undefined;
  if (!slot) throw new Error("Slot not found");
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
  if (!slot.topic.trim() || !research.angle) throw new Error("Pick a topic and an angle first");
  if (!JSON.parse(slot.platforms || "[]").length) throw new Error("Pick at least one platform first");
  db.prepare("DELETE FROM research_jobs WHERE slot_id = ? AND status = 'queued' AND kind = 'copy'").run(slotId);
  const id = newId();
  db.prepare("INSERT INTO research_jobs (id, slot_id, kind, status, created_at, updated_at) VALUES (?, ?, 'copy', 'queued', ?, ?)").run(id, slotId, now(), now());
  return { job_id: id };
}

/* Words for the picture itself: the line that goes on the poster, not the caption under it.
   Queued once drafts exist, so the suggestions can suit what was actually drawn. */
export function startPosterCopy(slotId: string) {
  const db = getDb();
  const slot = db.prepare("SELECT topic, research FROM slots WHERE id = ?").get(slotId) as { topic: string; research: string } | undefined;
  if (!slot) throw new Error("Slot not found");
  let research: Record<string, unknown> = {};
  try { research = JSON.parse(slot.research || "{}"); } catch { research = {}; }
  if (!slot.topic.trim()) throw new Error("Set a topic first");
  db.prepare("DELETE FROM research_jobs WHERE slot_id = ? AND status = 'queued' AND kind = 'postercopy'").run(slotId);
  const id = newId();
  db.prepare("INSERT INTO research_jobs (id, slot_id, kind, status, created_at, updated_at) VALUES (?, ?, 'postercopy', 'queued', ?, ?)").run(id, slotId, now(), now());
  return { job_id: id };
}

/* For posts in the next two weeks that still have no topic, ask Claude for three topic ideas each.
   Safe to call often: a slot with ideas, a topic, or an open request is skipped. */
export function queueTopicIdeas(days = 14, slotId?: string) {
  const db = getDb();
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = key(new Date());
  const to = key(new Date(Date.now() + days * 86400000));
  const rows = db.prepare(
    `SELECT s.id, s.research FROM slots s
     WHERE ${slotId ? "s.id = ?" : "s.date BETWEEN ? AND ? AND TRIM(s.topic) = '' AND s.status != 'posted'"}
       AND NOT EXISTS (SELECT 1 FROM research_jobs j WHERE j.slot_id = s.id AND j.kind = 'topics' AND j.status IN ('queued','running'))`,
  ).all(...(slotId ? [slotId] : [from, to])) as { id: string; research: string }[];
  let queued = 0;
  for (const r of rows) {
    let research: Record<string, unknown> = {};
    try { research = JSON.parse(r.research || "{}"); } catch { research = {}; }
    if (!slotId && Array.isArray(research.topic_ideas) && research.topic_ideas.length) continue;
    db.prepare("INSERT INTO research_jobs (id, slot_id, kind, status, created_at, updated_at) VALUES (?, ?, 'topics', 'queued', ?, ?)").run(newId(), r.id, now(), now());
    queued++;
  }
  return { queued };
}
