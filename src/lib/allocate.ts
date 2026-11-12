/* Who should do a piece of work, and why.

   A request arrives — a WhatsApp forward, an email, a note from a meeting — and becomes one or
   more tasks. Each task gets a kind (a poster, a video, a vendor follow-up…) and then a person.
   The person is chosen from what Circuit has seen, not from a rule somebody typed once and
   forgot:

     · what each person says they do (their profile, set on the Inbox page)
     · what each person has actually finished before, of this kind
     · every time a manager moved a task Circuit assigned — the strongest signal there is,
       because it is a person saying "not her, him" about exactly this kind of work
     · who is named in the message itself
     · how much each person already has open

   Every choice carries its reason in words, so a wrong assignment can be seen to be wrong and
   corrected — and the correction is what teaches it. No imports, so a page and a test can
   both read it. */

export const KINDS = [
  { key: "poster", label: "Poster or graphic", words: /\b(poster|creative|graphic|banner|flyer|design|standee|hoarding|artwork|thumbnail)\b/i },
  { key: "video", label: "Video", words: /\b(video|shoot a video|edit(ing)? the video|reel edit|youtube|motion|animation)\b/i },
  { key: "photo", label: "Photo shoot", words: /\b(photo|photoshoot|photo shoot|pictures|shoot)\b/i },
  { key: "print", label: "Print and merchandise", words: /\b(print|brochure|leaflet|pamphlet|visiting card|business card|merch|t-?shirt|sticker|catalogue)\b/i },
  { key: "event", label: "Event or launch", words: /\b(event|launch|expo|exhibition|dealer meet|test ride|roadshow|stall|booth)\b/i },
  { key: "website", label: "Website and blog", words: /\b(website|web ?page|landing page|seo|site|blog|blogs|article)\b/i },
  { key: "ads", label: "Ads and campaigns", words: /\b(ad|ads|campaign|boost|budget|meta ads|google ads|promotion|lead gen)\b/i },
  { key: "vendor", label: "Vendor and purchase", words: /\b(vendor|quotation|quote|invoice|bill|payment|purchase|order|agency|supplier)\b/i },
  { key: "reply", label: "Customer or dealer reply", words: /\b(reply|respond|customer|dealer|complaint|enquiry|inquiry|query|lead)\b/i },
  { key: "deck", label: "Deck and presentation", words: /\b(deck|decks|presentation|presentations|ppt|pptx|slides?|pitch|keynote)\b/i },
  { key: "report", label: "Report or research", words: /\b(report|analysis|research|data|numbers|competitor|review|summary)\b/i },
  { key: "social_post", label: "Social post", words: /\b(posts?|postings?|caption|reel|story|stories|instagram|insta|facebook|linkedin|tweet|carousel)\b/i },
  { key: "other", label: "Other", words: /$^/ },
] as const;
export type Kind = (typeof KINDS)[number]["key"];
export const KIND_KEYS = KINDS.map((k) => k.key) as Kind[];
export const kindLabel = (k: string): string => KINDS.find((x) => x.key === k)?.label || "Other";
export const isKind = (k: unknown): k is Kind => typeof k === "string" && (KIND_KEYS as string[]).includes(k);

/* The first kind whose words appear — used when ChatGPT is not available, and to check what
   ChatGPT said when it says something that is not a kind. Order matters: the thing to be made
   comes before what it is for, so "poster for the launch" is a poster, not an event, and
   "poster for Instagram" is a poster, not a social post — which is why social posts, named
   mostly by platform, are checked last. */
export function guessKind(text: string): Kind {
  for (const k of KINDS) if (k.key !== "other" && k.words.test(text)) return k.key;
  return "other";
}

export type Person = { id: string; name: string; email: string; takes_work: boolean; kinds: string[] };

/* "Everything else": a person whose profile holds this takes every kind of work that nobody
   else has claimed. It is how "Prasanth does the blog and the website, Gowtham does the rest"
   is said without ticking eleven boxes — and it stays true when a new kind is added. */
export const ANY = "*";
const claims = (p: Person, kind: string, pool: Person[]) =>
  p.kinds.includes(kind) || (p.kinds.includes(ANY) && !pool.some((o) => o.id !== p.id && o.kinds.includes(kind)));
export type Signals = {
  done: Record<string, Partial<Record<string, number>>>;       // person id → kind → tasks finished
  movedTo: Record<string, Partial<Record<string, number>>>;    // person id → kind → times a manager gave it to them
  movedFrom: Record<string, Partial<Record<string, number>>>;  // person id → kind → times a manager took it off them
  open: Record<string, number>;                                // person id → tasks not yet done
};
export type Choice = { id: string; name: string; score: number; why: string[] };

/* Names that appear in the message. "Gowtham" and "Gowtham R" both match; a first name of
   two letters does not, because "Al" is in half of all sentences. */
export function mentioned(text: string, people: Person[]): string[] {
  return people.filter((p) => {
    const first = p.name.trim().split(/\s+/)[0] || "";
    return first.length > 2 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  }).map((p) => p.id);
}

const W = { profile: 3, done: 1, doneCap: 6, movedTo: 4, movedFrom: 3, named: 6, load: 0.5 };

/* Everyone who takes work, best first, each with the reasons behind their score. */
export function rank(kind: string, people: Person[], s: Signals, named: string[] = []): Choice[] {
  const pool = people.filter((p) => p.takes_work);
  const label = kindLabel(kind).toLowerCase();
  return pool.map((p) => {
    const why: string[] = [];
    let score = 0;
    if (named.includes(p.id)) { score += W.named; why.push("named in the message"); }
    if (claims(p, kind, pool)) { score += W.profile; why.push(p.kinds.includes(kind) ? `does ${label} work` : "does everything nobody else does"); }
    const done = s.done[p.id]?.[kind] || 0;
    if (done) { score += Math.min(done, W.doneCap) * W.done; why.push(`finished ${done} like it`); }
    const to = s.movedTo[p.id]?.[kind] || 0;
    if (to) { score += to * W.movedTo; why.push(`given ${label} work by a manager ${to === 1 ? "once" : `${to} times`}`); }
    const from = s.movedFrom[p.id]?.[kind] || 0;
    if (from) { score -= from * W.movedFrom; why.push(`had it moved away ${from === 1 ? "once" : `${from} times`}`); }
    const open = s.open[p.id] || 0;
    score -= open * W.load;
    why.push(`${open} open`);
    return { id: p.id, name: p.name, score: Math.round(score * 10) / 10, why };
  }).sort((a, b) => b.score - a.score || (s.open[a.id] || 0) - (s.open[b.id] || 0) || a.name.localeCompare(b.name));
}

/* The pick and its reason in one line, for the task and the notification. */
export function pick(kind: string, people: Person[], s: Signals, named: string[] = []): { choice: Choice | null; reason: string } {
  const ranked = rank(kind, people, s, named);
  const best = ranked[0];
  if (!best) return { choice: null, reason: "Nobody is set to take work yet — tick 'Takes work' for someone on the Inbox page" };
  const evidence = best.why.filter((w) => !/ open$/.test(w));
  const reason = evidence.length
    ? `${best.name}: ${best.why.join(", ")}`
    : `${best.name}: no history for this kind yet, so the person with least on (${best.why.join(", ")})`;
  return { choice: best, reason };
}

/* One person for a whole job.

   "Book the hall" and "send the invites" are two tasks but one dealer meet, and splitting them
   between two people means two people each holding half of an event. So the tasks of a job go
   to one person: whoever the job's parts most strongly point at. The part with the clearest
   evidence wins — an event task's "does event work" outweighs a vendor task's "nobody has
   history for this". */
export function pickForJob(kinds: string[], people: Person[], s: Signals, named: string[] = []): { choice: Choice | null; reason: string } {
  let best: { choice: Choice | null; reason: string } = { choice: null, reason: "" };
  for (const k of kinds) {
    const p = pick(k, people, s, named);
    if (p.choice && (!best.choice || p.choice.score > best.choice.score)) best = p;
  }
  return best.choice ? best : pick(kinds[0] || "other", people, s, named);
}

/* What ChatGPT is asked for, and what is kept of its answer. Anything malformed is dropped
   rather than repaired: a task invented from a half-read answer is worse than one fewer task. */
export type Extracted = { title: string; kind: Kind; details: string; due: string; priority: "high" | "normal" | "low"; for_person: string; job: string };

export function cleanExtraction(raw: unknown, today: string): Extracted[] {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : []);
  const out: Extracted[] = [];
  for (const r of list.slice(0, 12)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = String(o.title || "").trim().slice(0, 140);
    if (!title) continue;
    const details = String(o.details || "").trim().slice(0, 1200);
    const kind = isKind(o.kind) ? o.kind : guessKind(`${title} ${details}`);
    const dueRaw = String(o.due || "").trim();
    /* A due date in the past is a misreading ("by the 5th" said on the 20th), not a task that
       is already late. It is dropped and the task gets the usual week. */
    const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) && dueRaw >= today ? dueRaw : "";
    const priority = o.priority === "high" || o.priority === "low" ? o.priority : "normal";
    out.push({ title, kind, details, due, priority, for_person: String(o.for_person || "").trim().slice(0, 60), job: String(o.job || "").trim().toLowerCase().slice(0, 60) });
  }
  return out;
}

/* Without ChatGPT: the message is one task, named by its first line. */
export function fallbackExtraction(text: string): Extracted[] {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 3) || "Request";
  return [{ title: first.slice(0, 120), kind: guessKind(text), details: text.trim().slice(0, 1200), due: "", priority: /\b(urgent|asap|today|immediately)\b/i.test(text) ? "high" : "normal", for_person: "", job: "" }];
}

export function extractionPrompt(text: string, sender: string, today: string, people: string[]): string {
  return `You turn a message received by the marketing team of BNC Motors (electric two-wheelers, India) into a list of tasks.

Today is ${today}. The team: ${people.join(", ") || "not set"}.
The message${sender ? ` came from ${sender}` : ""}:
"""
${text.slice(0, 6000)}
"""

Return JSON only: {"tasks":[{"title":"…","kind":"…","details":"…","due":"YYYY-MM-DD or empty","priority":"high|normal|low","for_person":"a team member's name if the message says who should do it, else empty","job":"a short name for the larger job this task is part of, the same for every task of that job"}]}

Rules:
- One task per separate piece of work actually asked for. Greetings, thanks and FYIs are not tasks. If nothing is asked, return {"tasks":[]}.
- Steps of one small job are one task, not several: "compare the quote and confirm it" is one task. A big job with genuinely different pieces of work (book a hall, send invites) may be several tasks — give them the same "job" so one person can own it.
- title: short and doable, starting with a verb ("Design the Diwali offer poster").
- kind: exactly one of ${KIND_KEYS.join(", ")}.
- details: what the message says that the person will need — names, numbers, sizes, links, who to reply to.
- due: only if the message gives or clearly implies a date; turn "tomorrow", "Friday", "by the 5th" into a date after today.
- priority: high only if the message says urgent, ASAP, today, or similar.`;
}
