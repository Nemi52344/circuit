import { getDb, getSetting, newId, now } from "@/lib/db";

/* Conversations worth joining, on LinkedIn and X.

   The other half of listening. `comments` holds what people said on our posts; this holds other
   people's posts where a reply from us would be welcome — somebody asking about range anxiety,
   a fleet operator weighing up electric, a thread under a competitor's launch.

   How it works, and why it works that way:

   Circuit does not read LinkedIn or X. Both block everything that is not a signed-in browser,
   automating either is against their terms, and this project's own rules put browser automation
   of any platform out of scope. So the posts are found through search — the same way a person
   would find them — the link is kept, and Circuit drafts what we would say. A person opens the
   link and posts it themselves. Nothing is ever sent from here, and there is no code path that
   could send it.

   The honest limit: LinkedIn blocks search crawlers hard, so coverage there is thin and patchy.
   X is better but still partial. Circuit reports what it found rather than implying it swept
   the platform, and every link is checked before it is shown. */

export const PLATFORMS = ["LinkedIn", "X"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STATUSES = ["new", "drafted", "joined", "ignored"] as const;
export type Status = (typeof STATUSES)[number];

export type Conversation = {
  id: string; platform: string; url: string; author: string; said: string;
  topic: string; why: string; reachable: string; draft: string; status: string;
  found_at: string; drafted_at: string | null; updated_at: string;
  /* Five ways to answer, each from a different angle. JSON in the database; parsed on read. */
  options: string; chosen: number; voice: string;
  /* The post as it was actually written, the platform's own embed of it, and its picture if it
     has one — the link to theirs, never a copy. */
  full_text: string; embed: string; image: string;
};

export type Option = { angle: string; text: string };

/* The five angles. Fixed rather than left to the model to invent, because "give me five
   comments" produces one comment five times — and because a choice is only a choice when the
   things being chosen between are actually different. */
export const ANGLES = [
  { key: "answer", label: "A straight answer", asks: "Answer the question the post actually asks, practically and specifically." },
  { key: "number", label: "With a number", asks: "Make one concrete point using a figure or an operating detail. Only a figure from the approved claims." },
  { key: "question", label: "A question back", asks: "Agree briefly, then ask the one question that would move the thread on. Genuine curiosity, not rhetorical." },
  { key: "experience", label: "From experience", asks: "Add something only somebody who does this would know — what happens in practice, what people get wrong." },
  { key: "pushback", label: "Polite pushback", asks: "Disagree with one part of the post, respectfully and with a reason. If there is nothing to disagree with, say what the post leaves out instead." },
] as const;

export const VOICES = ["brand", "person"] as const;

export const parseOptions = (raw: string): Option[] => {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

export const listConversations = (status?: string): Conversation[] =>
  status
    ? getDb().prepare("SELECT * FROM conversations WHERE status = ? ORDER BY found_at DESC").all(status) as Conversation[]
    : getDb().prepare("SELECT * FROM conversations ORDER BY found_at DESC").all() as Conversation[];

/* Only these two, and only a real post. A search will happily return a company page, a search
   results page or an article about LinkedIn, and none of those are a conversation. */
export function linkFault(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return "not a web address"; }
  if (u.protocol !== "https:") return "not https";
  const h = u.hostname.replace(/^www\./, "").toLowerCase();
  if (h === "linkedin.com" || h.endsWith(".linkedin.com")) {
    /* A LinkedIn post lives under /posts/, /feed/update/ or /pulse/. A bare company or profile
       page is not something you can reply to. */
    if (!/\/(posts|feed\/update|pulse)\//.test(u.pathname)) return "a LinkedIn page, not a post";
    return "";
  }
  if (h === "x.com" || h === "twitter.com") {
    if (!/\/status\/\d+/.test(u.pathname)) return "an X profile, not a post";
    return "";
  }
  return "not LinkedIn or X";
}

export const platformOf = (url: string): Platform | "" => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (h.endsWith("linkedin.com")) return "LinkedIn";
    if (h === "x.com" || h === "twitter.com") return "X";
  } catch { /* handled by linkFault */ }
  return "";
};

/* The platform's own embed of a post.

   Both publish one, and both are meant to be put in an iframe by anybody — this is the route
   they provide, not a way round the wall. It is also the only way to show the real post next to
   the comment being written about it, which is the whole point of the feed. */
export function embedUrl(url: string): string {
  const id = postId(url);
  if (!id) return "";
  return platformOf(url) === "LinkedIn"
    ? `https://www.linkedin.com/embed/feed/update/urn:li:activity:${id}`
    : `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=light&dnt=true`;
}

/* The numeric id inside a post link. LinkedIn hides it in the slug as -activity-NNN-, or spells
   it out in a feed URL; X has it as the last path segment. */
export function postId(url: string): string {
  try {
    const u = new URL(url);
    if (platformOf(url) === "LinkedIn") {
      return (u.pathname.match(/-activity-(\d+)/) || u.pathname.match(/activity:(\d+)/) || [])[1] || "";
    }
    return (u.pathname.match(/\/status\/(\d+)/) || [])[1] || "";
  } catch { return ""; }
}

const unescapeHtml = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

const textFrom = (html: string) =>
  unescapeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();

/* What the post actually says, from the platform's own embed.

   Returns nothing rather than guessing when the markup changes: a wrong post body is far worse
   than none, because every comment written from it would be confidently about something else. */
export async function fetchPost(url: string): Promise<{ text: string; author: string; image: string } | null> {
  const id = postId(url);
  if (!id) return null;
  const { fetchUrl } = await import("@/lib/sources");
  const plat = platformOf(url);

  try {
    if (plat === "X") {
      const r = await fetchUrl(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`, { timeoutMs: 10000, maxBytes: 200_000 });
      const j = JSON.parse(r.buffer.toString("utf8")) as { html?: string; author_name?: string };
      const body = (j.html || "").match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const text = body ? textFrom(body[1]) : "";
      return text ? { text, author: j.author_name || "", image: "" } : null;
    }

    const r = await fetchUrl(embedUrl(url), { timeoutMs: 12000, maxBytes: 600_000 });
    const html = r.buffer.toString("utf8");
    const body = html.match(/class="[^"]*attributed-text-segment-list__content[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      || html.match(/data-test-id="main-feed-activity-card__commentary"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
    const text = body ? textFrom(body[1]) : "";
    const who = html.match(/data-tracking-control-name="[^"]*actor[^"]*"[^>]*>\s*([^<]{2,80})/);
    /* The post's own picture, from the og:image meta tag.

       Two earlier attempts got this wrong. Reading the src attribute found nothing at all,
       because LinkedIn lazy-loads and every <img> in the embed is empty. Scraping the lazy-load
       attribute found the right picture and cut the address short, since it carries &amp;
       entities and a query string — six posts were stored with a URL that could not load.

       og:image is the one the platform publishes for exactly this purpose: complete, escaped
       once, and the same picture any link preview would show. A post with media gives a
       media.licdn.com/...feedshare... address; a text post gives a static.licdn.com
       placeholder, which is a LinkedIn logo and says nothing about the post, so it is dropped. */
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    const pic = og ? unescapeHtml(og[1]) : "";
    const image = /media\.licdn\.com/.test(pic) && /feedshare|articleshare|videocover/i.test(pic) ? pic : "";
    return text ? { text, author: (who?.[1] || "").trim(), image } : null;
  } catch { return null; }
}

/* Does the link actually go anywhere?

   A search can return a URL that was never real, and ten plausible dead links are worse than an
   empty list. The two platforms answer very differently, and the difference matters:

   X tells the truth. A real post answers 200 and an invented id answers 404, so its status can
   be trusted and a 404 means the post is not there.

   LinkedIn does not. Every post URL — real, deleted or never existent — redirects to
   /signup/cold-join and answers 200, so a status check on LinkedIn proves nothing at all. The
   first version of this recorded "link checked" for anything LinkedIn-shaped, which is the one
   outcome worth avoiding: a made-up link wearing a tick. Landing on a sign-up or login wall is
   therefore reported as "blocked" — Circuit could not tell — rather than as verified.

   So "blocked" means "open it and see", and it is the normal answer for LinkedIn. */
const WALL = /\/(signup|login|authwall|uas\/login|checkpoint)/i;

export async function checkLink(url: string): Promise<"ok" | "blocked" | "gone" | "unchecked"> {
  /* The embed settles it. A post whose text comes back exists and is public — which a status
     code from LinkedIn could never establish, since it answers 200 for everything. */
  const got = await fetchPost(url);
  if (got?.text) return "ok";
  try {
    const { fetchUrl } = await import("@/lib/sources");
    const r = await fetchUrl(url, { timeoutMs: 8000, maxBytes: 200_000 });
    const status = (r as { status?: number }).status ?? 200;
    const landed = (r as { finalUrl?: string }).finalUrl || url;
    if (status === 404 || status === 410) return "gone";
    if (status === 403 || status === 429 || status === 999) return "blocked";
    /* Redirected to a wall: the platform answered, but about itself, not about the post. */
    if (WALL.test(new URL(landed).pathname)) return "blocked";
    return status >= 200 && status < 400 ? "ok" : "blocked";
  } catch {
    /* A refusal at the network layer is the same situation: the platform does not want a script
       here. It says nothing about whether the post exists. */
    return "blocked";
  }
}

type Found = { url?: string; author?: string; said?: string; topic?: string; why?: string };

/* One broad search comes back with two or three posts, however many you ask for — the model
   casts about across the whole subject and returns only what it is sure of. Several narrow
   searches, each pointed at one kind of conversation, come back with two or three each, and
   they are different two or three.

   So a sweep is six searches rather than one. Slower, and the only thing that actually fills
   the list. Each is phrased as the conversation to look for, not as a keyword. */
const SWEEP = [
  "people asking which electric two-wheeler to buy, or whether one suits their daily commute",
  "delivery, logistics and gig fleet operators discussing electrifying their two-wheelers",
  "range anxiety, real-world range, charging time and battery life on electric two-wheelers",
  "running cost of electric against petrol two-wheelers in India, and EV subsidies or policy",
  "launches, sales figures and comparisons involving Ola, Ather, TVS, Bajaj, Revolt or Ultraviolette",
  "service networks, spare parts, resale value and what ownership is actually like after a year",
];

/* Asks ChatGPT, with search on, for public posts worth replying to. */
export async function findConversations(opts: { platforms?: string[]; topics?: string; limit?: number } = {}) {
  const { runChatGptJson } = await import("@/lib/chatgpt");
  const { getBrand } = await import("@/lib/brand");
  const brand = getBrand();
  const platforms = (opts.platforms?.length ? opts.platforms : [...PLATFORMS]).filter((p) => (PLATFORMS as readonly string[]).includes(p));
  if (!platforms.length) throw new Error("Say which platform to look on");
  const limit = Math.max(1, Math.min(25, opts.limit || 10));

  const competitors = (() => {
    try { const v = JSON.parse(getSetting("competitors") || "[]"); return Array.isArray(v) ? v.join(", ") : ""; } catch { return ""; }
  })();

  /* A sweep is one search per platform per angle, run until the target is met.

     Two things were wrong before. One prompt naming both platforms let the model answer entirely
     with LinkedIn — eight posts found and not a single one from X — because nothing made it
     split its attention. And a fixed six passes stopped whether or not anything had been found.

     So each pass asks about one platform only, the platforms are interleaved so both get early
     attempts rather than X waiting behind six LinkedIn searches, and the loop stops as soon as
     there are enough. A pass costs about fifty seconds, so stopping early is the difference
     between four minutes and twelve. */
  const angles = opts.topics?.trim() ? [opts.topics.trim()] : SWEEP;
  const plan: { platform: string; angle: string }[] = [];
  for (const angle of angles) for (const pf of platforms) plan.push({ platform: pf, angle });

  const db = getDb();
  const at = now();
  let added = 0;
  let already = 0;
  let asked = 0;
  let passes = 0;
  const rejected: { url: string; why: string }[] = [];
  const perPlatform: Record<string, number> = Object.fromEntries(platforms.map((p) => [p, 0]));

  for (const step of plan) {
    if (added >= limit) break;
    passes += 1;
    const found = await onePass(step.angle, step.platform, 4, brand, competitors);
    asked += found.length;
    for (const p of found) {
      const url = (p.url || "").trim();
      if (!url) continue;
      const fault = linkFault(url);
      if (fault) { rejected.push({ url, why: fault }); continue; }
      /* A pass asked about X that answers with a LinkedIn post is not what was asked for, but
         it is still a real post worth commenting on, so it is kept and counted where it belongs
         rather than thrown away on a technicality. */
      const plat = platformOf(url) || step.platform;
      if (db.prepare("SELECT 1 FROM conversations WHERE url = ?").get(url)) { already += 1; continue; }
      const got = await fetchPost(url);
      const reachable = got?.text ? "ok" : await checkLink(url);
      if (reachable === "gone") { rejected.push({ url, why: "the post is not there" }); continue; }
      db.prepare(`INSERT INTO conversations (id, platform, url, author, said, topic, why, reachable, full_text, embed, image, status, found_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`)
        .run(newId(), plat, url,
          (got?.author || p.author || "").slice(0, 120),
          (p.said || "").slice(0, 600), (p.topic || "").slice(0, 80), (p.why || "").slice(0, 300), reachable,
          (got?.text || "").slice(0, 6000), embedUrl(url), (got?.image || "").slice(0, 600), at, at);
      added += 1;
      perPlatform[plat] = (perPlatform[plat] || 0) + 1;
    }
  }

  return { added, already, rejected, asked, platforms, passes, perPlatform };
}

/* One search, pointed at one kind of conversation. */
async function onePass(
  angle: string, platform: string, want: number,
  brand: { name: string; tagline: string; audience?: string }, competitors: string,
): Promise<Found[]> {
  const { runChatGptJson } = await import("@/lib/chatgpt");
  const prompt = [
    `Find up to ${want} recent public posts on ${platform} — and only on ${platform} — where a comment from this company would be welcome and on-topic.`,
    "",
    `The company: ${brand.name} — ${brand.tagline}.`,
    brand.audience ? `Who it sells to: ${brand.audience}` : "",
    competitors ? `Competitors: ${competitors}` : "",
    `Look specifically for: ${angle}`,
    "",
    "What counts:",
    "- a real post by a person or company, published in the last 30 days",
    "- somebody asking a question, sharing an opinion, or discussing the category",
    "- a place where a short, useful, non-salesy reply would add something",
    "",
    "What does not count, and must not be returned:",
    "- a company page, profile page, hashtag page or search results page",
    `- anything not on ${platform}. A post on the other platform does not answer this.`,
    "- a news article, blog post or anything not on LinkedIn or X",
    "- our own posts",
    "- anything you are not confident actually exists at that exact URL",
    "",
    "Do not invent URLs. If you cannot find the real permalink to a post, leave it out. A short",
    "list of real posts is worth far more than a long list that does not resolve.",
    "",
    "Answer as JSON only:",
    '{"posts":[{"url":"https://...","author":"who posted it","said":"what the post says, in one or two sentences","topic":"the subject in three words","why":"why a reply from us belongs here"}]}',
  ].filter(Boolean).join("\n");

  /* A pass that comes back empty is a fact about what is indexed, not a failure — the sweep
     carries on with the next angle rather than giving up on all six. */
  try {
    const raw = await runChatGptJson(prompt, { search: true, timeoutMs: 6 * 60 * 1000 });
    const posts = (raw as { posts?: Found[] })?.posts;
    return Array.isArray(posts) ? posts.slice(0, want) : [];
  } catch {
    return [];
  }
}

/* Writes five ways to answer, one per angle.

   Grounded in the claims somebody has already stood behind, because a comment on a stranger's
   post is the worst possible place to invent a number.

   Voice matters more than it looks. A company page commenting on LinkedIn reaches a fraction of
   what a person does and reads as marketing; the same thought from a named human carries. So
   the draft is written either as the brand or as the owner, and the words differ. */
export async function draftOptions(id: string, voice: string = "brand"): Promise<Conversation> {
  const { runChatGptJson } = await import("@/lib/chatgpt");
  const { getBrand } = await import("@/lib/brand");
  const db = getDb();
  const c = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
  if (!c) throw new Error("That conversation is not here any more");
  const asPerson = voice === "person";

  const brand = getBrand();
  const facts = (db.prepare(`SELECT title, body FROM knowledge WHERE status = 'live'
                             ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
                             LIMIT 25`).all() as { title: string; body: string }[])
    .map((f) => [f.title, f.body].filter(Boolean).join(" — ").trim()).filter(Boolean);

  const who = asPerson
    ? `You are writing as the person who runs marketing at ${brand.name}, commenting from their own account. First person singular. They build electric motorcycles; they are not a bystander.`
    : `You are writing as ${brand.name}, commenting from the company account. First person plural.`;

  const prompt = [
    `Write ${ANGLES.length} different comments to leave on this ${c.platform} post. One per angle below.`,
    "",
    who,
    `Voice: ${brand.tone || "Confident, precise, no hype. Short sentences."}`,
    "",
    /* The post in full where we have it. Writing from a summary was the whole problem: a
       paraphrase keeps the subject and loses every specific, and the specifics are the only
       thing a comment can usefully answer. */
    c.full_text
      ? `The post${c.author ? `, by ${c.author}` : ""}, in full:\n"""\n${c.full_text.slice(0, 3000)}\n"""`
      : `The post${c.author ? ` by ${c.author}` : ""}, as far as we know it: ${c.said}`,
    c.why ? `Why we are replying: ${c.why}` : "",
    "",
    /* Somebody asking for suppliers and somebody musing about the market need opposite replies,
       and a blanket no-pitch rule turns the first into a wasted comment. */
    "Read what the post is doing before answering it. If the author is asking for something —",
    "suppliers, recommendations, help — then the useful comment answers the ask directly and may",
    "say plainly that we build these and will be in touch. If the post is an opinion or an",
    "observation, do not pitch at all; add to the thinking instead.",
    "",
    "The angles, in order:",
    ...ANGLES.map((a, i) => `${i + 1}. ${a.label} — ${a.asks}`),
    "",
    facts.length ? `The only claims that may be stated as fact:\n- ${facts.join("\n- ")}` : "There are no recorded claims, so state no figures at all.",
    "",
    "Rules for every one of them:",
    "- 20 to 45 words. Shorter is better. One idea each.",
    "- plain English. No 'leverage', 'framework', 'ecosystem', 'strategic', 'holistic', 'robust'.",
    "- say it, do not hedge it. Avoid stacking 'I would' — write what is true.",
    "- be specific enough that it could not be posted under a different article.",
    `- ${c.author ? `address ${c.author.split(" ")[0]} by name where it reads naturally, not in every one` : "do not invent a name to address"}`,
    "- add something the thread does not already have",
    "- no pitch, no link, no call to action, no hashtags, no emoji",
    "- never state a figure that is not in the list above",
    "- the five must be genuinely different, not one comment reworded five times",
    "",
    `Answer as JSON only: {"comments":[{"angle":"answer","text":"..."}, ...]} with the angle keys ${ANGLES.map((a) => `"${a.key}"`).join(", ")}.`,
  ].filter(Boolean).join("\n");

  const raw = await runChatGptJson(prompt, { timeoutMs: 10 * 60 * 1000 }) as { comments?: { angle?: string; text?: string }[] };
  const back = Array.isArray(raw?.comments) ? raw.comments : [];

  /* Matched to the angles we asked for rather than taken in whatever order they came back, and
     anything that does not match an angle we asked for is dropped. A model that returns four is
     common; four real options are worth more than five with a filler. */
  const options: Option[] = [];
  for (const a of ANGLES) {
    const hit = back.find((b) => (b.angle || "").toLowerCase() === a.key);
    const text = (hit?.text || "").trim();
    if (text) options.push({ angle: a.label, text });
  }

  if (!options.length) throw new Error("ChatGPT came back with nothing usable");

  db.prepare("UPDATE conversations SET options = ?, voice = ?, chosen = -1, status = 'drafted', drafted_at = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(options), asPerson ? "person" : "brand", now(), now(), id);
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation;
}

/* Picking one. The index is kept so it is possible to see later which kind of comment actually
   earns a reply — the whole point of offering five different angles rather than five rewrites. */
export function chooseOption(id: string, index: number): Conversation {
  const db = getDb();
  const c = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
  if (!c) throw new Error("That conversation is not here any more");
  const options = parseOptions(c.options);
  if (index < 0 || index >= options.length) throw new Error("That is not one of the options");
  db.prepare("UPDATE conversations SET chosen = ?, draft = ?, updated_at = ? WHERE id = ?")
    .run(index, options[index].text, now(), id);
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation;
}

/* A post you found yourself, added by its link.

   The only route to X. Search cannot see it: X blocks crawlers and requires a login for most
   content, so there is next to nothing in any index to find — an X-only search phrased as
   loosely as it could be came back with nothing at all. It is also the better route for
   LinkedIn, where search reaches a thin slice of what is actually posted and you scroll past
   the rest every day.

   Everything that happens to a searched post happens here: the link is checked by shape, the
   post is read through the platform's own embed, and the picture comes with it. */
export async function addByLink(url: string): Promise<Conversation> {
  const link = (url || "").trim();
  const fault = linkFault(link);
  if (fault) throw new Error(`That is ${fault}. Paste the link to a single post.`);

  const db = getDb();
  const existing = db.prepare("SELECT * FROM conversations WHERE url = ?").get(link) as Conversation | undefined;
  if (existing) throw new Error("That post is already here");

  const got = await fetchPost(link);
  const reachable = got?.text ? "ok" : await checkLink(link);
  if (reachable === "gone") throw new Error("That post is not there any more");

  const at = now();
  const id = newId();
  db.prepare(`INSERT INTO conversations (id, platform, url, author, said, topic, why, reachable, full_text, embed, image, status, found_at, updated_at)
              VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, 'new', ?, ?)`)
    .run(id, platformOf(link) || "LinkedIn", link, (got?.author || "").slice(0, 120),
      "You picked this one.", reachable, (got?.text || "").slice(0, 6000), embedUrl(link),
      (got?.image || "").slice(0, 600), at, at);
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation;
}

/* Goes and reads the post itself, for rows saved before Circuit knew how to.

   Also the repair for a post that was edited after it was found: the comment should answer what
   is there now, not what was there a fortnight ago. */
export async function refreshPost(id: string): Promise<Conversation> {
  const db = getDb();
  const c = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
  if (!c) throw new Error("That conversation is not here any more");
  const got = await fetchPost(c.url);
  if (!got?.text) throw new Error("The platform did not hand the post over — open it instead");
  db.prepare("UPDATE conversations SET full_text = ?, author = COALESCE(NULLIF(?, ''), author), embed = ?, image = ?, reachable = 'ok', updated_at = ? WHERE id = ?")
    .run(got.text.slice(0, 6000), got.author || "", embedUrl(c.url), (got.image || "").slice(0, 600), now(), id);
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation;
}

export function saveConversation(c: Partial<Conversation> & { id: string }): Conversation {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(c.id)) throw new Error("That conversation is not here any more");
  if (c.status && !(STATUSES as readonly string[]).includes(c.status)) throw new Error("Unknown status");
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of ["draft", "status", "why", "topic"] as const) {
    if (c[f] !== undefined) { sets.push(`${f} = ?`); vals.push(c[f]); }
  }
  if (sets.length) db.prepare(`UPDATE conversations SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, now(), c.id);
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(c.id) as Conversation;
}

export const removeConversation = (id: string) => {
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
  return { deleted: id };
};

export function joinSummary() {
  const db = getDb();
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  return {
    total: n("SELECT COUNT(*) n FROM conversations"),
    new: n("SELECT COUNT(*) n FROM conversations WHERE status = 'new'"),
    drafted: n("SELECT COUNT(*) n FROM conversations WHERE status = 'drafted'"),
    joined: n("SELECT COUNT(*) n FROM conversations WHERE status = 'joined'"),
    blocked: n("SELECT COUNT(*) n FROM conversations WHERE reachable = 'blocked'"),
  };
}
