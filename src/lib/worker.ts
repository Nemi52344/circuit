import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting, now, forEachBrand, listBrands, currentBrand, tryFilePath } from "@/lib/db";
import { runChatGptJson, runChatGptImage, codexPath } from "@/lib/chatgpt";
import { igSyncDue, syncCompetitorInstagram } from "@/lib/igsync";
import { backupDue, runBackup } from "@/lib/backup";
import { insightsDue, syncOwnInstagram } from "@/lib/insights";
import { autoRenewDue, renewStoredToken } from "@/lib/meta";
import { dueWorkflows, runWorkflow, seedWorkflows } from "@/lib/workflows";
import { INTERNAL_HEADER, BRAND_HEADER, internalSecret, selfOrigin } from "@/lib/http";

/* The automatic worker: while Circuit is running it picks up queued text jobs (brand, ideas,
   topics, research, captions) one at a time, asks ChatGPT for the answer, and delivers it through
   the same endpoints a person or a Claude session would use. Image jobs are not touched. */

type Job = Record<string, unknown> & { id: string; kind: string; status: string };
type Run = { id: string; kind: string; label: string; ok: boolean; error: string; started_at: string; finished_at: string; seconds: number };
type State = { timer: NodeJS.Timeout | null; busy: boolean; current: { id: string; kind: string; label: string; started_at: string } | null; history: Run[]; last_check: string };

declare global {
  // eslint-disable-next-line no-var
  var __circuitWorker: State | undefined;
}
const state: State = (global.__circuitWorker ??= { timer: null, busy: false, current: null, history: [], last_check: "" });

const listBrandsCount = () => listBrands().length;

const ORDER = ["brand", "ideas", "topics", "research", "slides", "postercopy", "copy"];
/* The origin this server answered a real request on, falling back to the configured port only
   until the first one arrives. Guessing 3210 outright meant a second copy on another port
   called the first one instead of itself. */
const base = () => selfOrigin() || `http://127.0.0.1:${process.env.PORT || 3210}`;

export function workerEnabled() {
  return (getSetting("ai_worker") || "chatgpt") === "chatgpt";
}
export function setWorkerEnabled(on: boolean) {
  setSetting("ai_worker", on ? "chatgpt" : "off");
  if (on) kickWorker();
}
export function workerState() {
  return { enabled: workerEnabled(), busy: state.busy, current: state.current, history: state.history.slice(0, 10), last_check: state.last_check, provider: "ChatGPT", installed: Boolean(codexPath()) };
}

async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(`${base()}${p}`, {
    method,
    /* Circuit calling itself. Without this the gate sees a request with no cookie and turns it
       away, which is what silently stopped the queues the day accounts were added. */
    headers: { "Content-Type": "application/json", [INTERNAL_HEADER]: internalSecret(), [BRAND_HEADER]: currentBrand().slug },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : `HTTP ${r.status}`);
  return data;
}

const RULES = [
  "Only state facts you found in the job data or in sources you searched. Never invent product numbers (range, price, battery size, speed, warranty); use only facts given in brand.claims, profile.facts or the brand's own pages, otherwise write [check spec sheet].",
  "Write for Indian buyers. Plain, confident, no hype.",
  "Plain text inside every field: no markdown, no links inside sentences (put URLs only in sources).",
  "\"conversation\" is always the real signal you found (a search people type, a thread title, a headline, a key date), never an instruction to the owner.",
  "Return ONLY one JSON object, no commentary and no code fence.",
  "job.learned_so_far is what Circuit has already found out about this market, each item with its source and date. Use it, prefer it over guessing, and say when something in it is out of date rather than repeating it blindly.",
].join("\n");

function trimJob(job: Job) {
  // keep prompts a sensible size: long site pages and signal notes are cut
  const j = JSON.parse(JSON.stringify(job)) as Record<string, unknown>;
  const site = j.site as { pages?: { text: string }[] } | undefined;
  site?.pages?.forEach((p) => { p.text = p.text.slice(0, 3000); });
  return j;
}

function promptFor(job: Job): { prompt: string; deliver: string; label: string } {
  const data = JSON.stringify(trimJob(job));
  switch (job.kind) {
    case "brand":
      return {
        label: "Learning the brand from its website",
        deliver: "/api/brand/deliver",
        prompt: `You are the brand strategist inside Circuit, a marketing app.
Task: read the brand's website pages in the job data and search the web for what Indian buyers say about this brand, its category and its competitors (reviews, Reddit, YouTube, news).
${RULES}
JSON shape:
{"sells":"1-2 sentences","buyers":"1-2 sentences","problem":"1-2 sentences","cares":["3-6 short points"],"misunderstands":["3-6"],"complains":["3-6"],"competitors_talk":["3-6"],"competitors":["names"],"keywords":["5-8 short search phrases real buyers type, not slogans"],"facts":[{"fact":"only facts stated on the brand's own pages","source":"page url"}],"content_opportunities":["3-6"],"sources":[{"title":"","url":""}]}
Job data:
${data}`,
      };
    case "ideas": {
      return {
        label: `Writing topic ideas for ${String(job.month || "the month")}`,
        deliver: "/api/ideas/deliver",
        prompt: `You are the content strategist inside Circuit, a marketing app. Method: world → audience → conversation → idea → content.
Task: for EVERY slot in job.slots write exactly 3 topic ideas. Use job.profile (brand and audience), job.conversation (Google and YouTube searches people type, news, Reddit, Google Trends, competitor ads and Instagram posts), job.key_dates and each slot's key_dates_near. Search the web to cover Instagram reels and comments, LinkedIn conversations and "People also ask" for the niche.
Rules for each idea:
- topic under 60 characters and fits the slot's pillar; Friday (Rider stories) favours customer testimonials.
- if a key date is on or near the slot, at least one idea uses it; vehicle buying days matter most.
- format is one of "image" (static post), "carousel", "video" (reel), "text".
- hook is the first line or on-screen text; why is one sentence.
- conversation names the real signal, e.g. Google search: "why electric scooter catches fire".
- keywords: 3-6 visual words for matching inspiration images.
- never repeat anything in job.used_topics, and don't repeat topics across slots.
${RULES}
JSON shape:
{"slots":[{"slot_id":"<from job.slots>","ideas":[{"topic":"","format":"","hook":"","why":"","conversation":"","keywords":[""]}]}]}
Job data:
${data}`,
      };
    }
    case "topics":
      return {
        label: `Suggesting topics for ${String(job.date || "a post")}`,
        deliver: "/api/topics/deliver",
        prompt: `You are the content strategist inside Circuit, a marketing app.
Task: write exactly 3 topic ideas for this one post. Use job.pillar, job.pillar_description, job.date, job.platforms, job.profile and job.brand. Search the web for anything timely in India around that date (festivals, monsoon, fuel prices, EV policy, competitor launches). Never repeat job.used_topics.
Each idea: topic under 60 characters; format "image" | "carousel" | "video" | "text"; hook (first line); why (one sentence); conversation (the real signal); keywords (3-6 visual words).
${RULES}
JSON shape: {"ideas":[{"topic":"","format":"","hook":"","why":"","conversation":"","keywords":[""]}]}
Job data:
${data}`,
      };
    case "research":
      return {
        label: `Researching "${String(job.topic || "a post")}"`,
        deliver: "/api/research/deliver",
        prompt: `You are the market researcher inside Circuit, a marketing app.
Task: research THIS POST'S TOPIC ONLY, for Indian electric two-wheeler buyers.
The topic is the whole brief. Everything you write must be about it. Use job.signals (news on the topic, what competitors said about this topic, Reddit threads, and the phrases people actually search about it) and search the web for more ON THIS TOPIC. Discard any signal that is not about the topic, however interesting it is — a general EV headline, a competitor launch, a festival, a country-wide trend all belong in the bin unless they are about this topic. If a section has nothing on-topic to say, say so in one plain line rather than filling it with something else.
${RULES}
JSON shape:
{"competitor":"2-4 sentences on what competitors are doing on this topic","market":"2-4 sentences on what Indian buyers care about here","topic":"2-3 sentences on what riders themselves are saying","trends":"1-3 sentences on what people search about THIS topic and any timely hook for it, or say plainly there is nothing timely on this topic","angles":[{"angle":"","message":"one short line","why":""}],"recommended_format":"image|carousel|video|text","keywords":["4-8 visual words"],"sources":[{"title":"","url":""}]}
Give exactly 3 angles.
Job data:
${data}`,
      };
    case "slides":
      return {
        label: `Planning the carousel for "${String(job.topic || "a post")}"`,
        deliver: "/api/slides/deliver",
        prompt: `You are the content designer inside Circuit, a marketing app.
Task: plan a swipeable carousel for this post from job.topic, job.angle and job.message, for job.platforms.
- 5 to 7 slides. Slide 1 is the hook that stops the scroll; the middle slides carry one idea each; the last slide is a clear call to action.
- headline: at most 8 words, the big words on the slide. body: at most 25 words in plain sentences, or empty when the headline says it all.
- image_idea: one sentence describing the picture for that slide (the product, a detail, a rider, a simple diagram). Write "text only" when the slide is words on a plain background.
${RULES}
JSON shape: {"slides":[{"headline":"","body":"","image_idea":""}]}
Job data:
${data}`,
      };
    case "postercopy":
      return {
        label: `Writing picture text for "${String(job.topic || "a post")}"`,
        deliver: "/api/postercopy/deliver",
        prompt: `You are the art director inside Circuit, a marketing app.
Task: write the words that go ON the picture for this post — the line someone reads in half a second while scrolling. This is not the caption below the post.
Give EXACTLY 8 options, genuinely different from each other, not one line reworded 8 times. Across the set include at least one of each: a plain statement of the benefit, a question the rider is already asking, a number or comparison (only from facts given, never invented), a festive or timely line if the post is near a key date, and a short two-word stamp.
- line: at most 7 words. This is the big text.
- sub: an optional second line, at most 10 words, or empty.
- style: one or two words naming the approach (for example "benefit", "question", "number", "festive", "stamp").
- note: one short line on when to use it.
Write for Indian riders. No hashtags, no emoji, no quotation marks around the line, no full stops on a stamp.
${RULES}
JSON shape: {"lines":[{"line":"","sub":"","style":"","note":""}]}
Job data:
${data}`,
      };
    case "copy":
      return {
        label: `Writing captions for "${String(job.topic || "a post")}"`,
        deliver: "/api/copy/deliver",
        prompt: `You are the copywriter inside Circuit, a marketing app.
Task: write THREE different options for EVERY platform in job.platforms, from job.topic, job.angle and job.message, in the tone in job.brand.tone. Repeat the platform name for each option.
Make the three genuinely different, not reworded: one leads with the practical benefit, one opens with a question or a rider's voice, one is short and punchy. Give each a two or three word label saying what it is, for example "Practical", "Rider voice", "Short and punchy".
- Instagram: a hook line, 3-6 short lines, a call to action; 5-8 hashtags.
- Facebook: 2-4 short paragraphs, plain and friendly; 3-5 hashtags.
- LinkedIn: professional, 3-5 short paragraphs; 3 hashtags.
- X: under 280 characters including hashtags; 1-2 hashtags.
- Blog: a title plus a 500-800 word article in caption; no hashtags.
${RULES}
JSON shape: {"posts":[{"platform":"","label":"","caption":"","hashtags":"","title":""}]}  (three entries per platform)
Job data:
${data}`,
      };
    default:
      throw new Error(`Unknown job kind ${job.kind}`);
  }
}

async function runOne(job: Job) {
  const { prompt, deliver, label } = promptFor(job);
  const started = Date.now();
  state.current = { id: job.id, kind: job.kind, label, started_at: now() };
  await api("PATCH", "/api/research", { id: job.id, status: "running" });
  let ok = true;
  let error = "";
  try {
    /* Ten minutes was where a copy job died in September and stayed dead. Every kind here
       searches before it writes, so they all get the longer ceiling; the runner retries once
       more on top of that if a run stalls. */
    const result = await runChatGptJson(prompt, { search: true, timeoutMs: (job.kind === "ideas" ? 20 : 15) * 60 * 1000 });
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("ChatGPT's answer wasn't a JSON object");
    await api("POST", deliver, { ...(result as Record<string, unknown>), job_id: job.id });
  } catch (e) {
    ok = false;
    error = (e as Error).message.slice(0, 500);
    await api("PATCH", "/api/research", { id: job.id, status: "failed", error: `ChatGPT: ${error}` }).catch(() => null);
  }
  state.history.unshift({ id: job.id, kind: job.kind, label, ok, error, started_at: new Date(started).toISOString(), finished_at: now(), seconds: Math.round((Date.now() - started) / 1000) });
  state.history = state.history.slice(0, 30);
  state.current = null;
}

type RenderJob = { id: string; prompt: string; reference_file_id: string | null; product_file_id: string | null; slot_id: string | null };

function uploadPath(fileId: string | null) {
  if (!fileId) return null;
  const p = tryFilePath(fileId) || null;
  return p && fs.existsSync(p) ? p : null;
}

/* A ChatGPT draft: reference first (image 1), product second (image 2), same prompt Higgsfield gets. */
async function renderOne(job: RenderJob) {
  const label = "Creating a draft with ChatGPT";
  const started = Date.now();
  state.current = { id: job.id, kind: "image", label, started_at: now() };
  await api("PATCH", "/api/render", { id: job.id, status: "running" });
  let ok = true;
  let error = "";
  try {
    const images = [uploadPath(job.reference_file_id), uploadPath(job.product_file_id)].filter((x): x is string => Boolean(x));
    if (!images.length) throw new Error("The reference and product images are missing");
    const file = await runChatGptImage(job.prompt, images);
    const form = new FormData();
    form.append("job_id", job.id);
    form.append("model", "chatgpt_image");
    form.append("title", "ChatGPT image");
    form.append("files", new Blob([fs.readFileSync(file)], { type: file.endsWith(".png") ? "image/png" : "image/jpeg" }), path.basename(file));
    const r = await fetch(`${base()}/api/render/deliver`, {
      method: "POST", body: form, headers: { [INTERNAL_HEADER]: internalSecret(), [BRAND_HEADER]: currentBrand().slug },
    });
    if (!r.ok) throw new Error(`Couldn't save the image: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    ok = false;
    error = (e as Error).message.slice(0, 500);
    await api("PATCH", "/api/render", { id: job.id, status: "failed", error: `ChatGPT: ${error}` }).catch(() => null);
  }
  state.history.unshift({ id: job.id, kind: "image", label, ok, error, started_at: new Date(started).toISOString(), finished_at: now(), seconds: Math.round((Date.now() - started) / 1000) });
  state.history = state.history.slice(0, 30);
  state.current = null;
}

/* One pass, for every brand in turn.

   Each brand has its own calendar, its own queue and its own Instagram, so each needs its own
   round. The brand is carried on the async context rather than by changing the stored choice,
   so a page loading while the worker is partway through BOOMA still shows whoever the person
   actually has selected. */
export async function tick() {
  if (state.busy || !workerEnabled() || !codexPath()) return;
  state.busy = true;
  state.last_check = now();
  try {
    await forEachBrand(async (brand) => { await brandPass(brand.name); });
  } finally {
    state.busy = false;
  }
}

async function brandPass(brandName: string) {
  setSetting("worker_last_tick", now());
  const tag = (label: string) => (listBrandsCount() > 1 ? `${brandName}: ${label}` : label);
  try {
    // a copy of the database and the pictures, once a day, without being asked
    if (backupDue()) {
      const b = await runBackup().catch((e: Error) => ({ error: e.message, db_bytes: 0 }));
      state.history.unshift({ id: "", kind: "backup", label: "error" in b ? "Backup failed" : "Backed up the database and pictures", ok: !("error" in b), error: "error" in b ? (b.error as string) : "", started_at: now(), finished_at: now(), seconds: 0 });
      state.history = state.history.slice(0, 30);
    }

    // the online copy in Turso, a few minutes behind this Mac; a failure is shown, never fatal
    const { mirrorDue, pushMirror } = await import("@/lib/mirror");
    if (mirrorDue()) {
      const r = await pushMirror().catch((e: Error) => ({ ok: false, sent: 0, deleted: 0, error: e.message }));
      if (!r.ok || r.sent || r.deleted) {
        state.history.unshift({ id: "", kind: "mirror", label: r.ok ? `Sent ${r.sent + r.deleted} change${r.sent + r.deleted === 1 ? "" : "s"} to the online copy` : "Couldn't update the online copy", ok: r.ok, error: r.error || "", started_at: now(), finished_at: now(), seconds: 0 });
        state.history = state.history.slice(0, 30);
      }
    }

    // work arriving by email: look at the folder, then read whatever is waiting into tasks
    const { mailWorkDue, checkWorkMail } = await import("@/lib/mailwork");
    if (mailWorkDue()) {
      const r = await checkWorkMail().then((x) => ({ ok: true, found: x.found, error: "" })).catch((e: Error) => ({ ok: false, found: 0, error: e.message }));
      if (!r.ok || r.found) {
        state.history.unshift({ id: "", kind: "mail", label: r.ok ? `${r.found} work email${r.found === 1 ? "" : "s"} arrived` : "Couldn't read the work mail folder", ok: r.ok, error: r.error, started_at: now(), finished_at: now(), seconds: 0 });
        state.history = state.history.slice(0, 30);
      }
    }
    const { unreadRequests, readRequest } = await import("@/lib/inbox");
    for (const req of unreadRequests(2)) await readRequest(req.id).catch(() => null);

    // raw collateral from the watched folder (the synced OneDrive folder), in the background
    const { watchDue, scanWatchFolder } = await import("@/lib/collateral");
    if (watchDue()) scanWatchFolder().catch(() => null);

    // reels waiting in the video studio; the edit carries on in the background
    const { workVideoQueue } = await import("@/lib/videoedit");
    workVideoQueue().catch(() => null);

    // keep the Meta connection alive: swap the token for a fresh one before it runs out
    if (autoRenewDue()) {
      const r = await renewStoredToken().then((x) => ({ ok: true, until: x.until, error: "" })).catch((e: Error) => ({ ok: false, until: "", error: e.message }));
      state.history.unshift({ id: "", kind: "meta", label: r.ok ? `Renewed the Meta token, good until ${r.until}` : "Couldn't renew the Meta token", ok: r.ok, error: r.error, started_at: now(), finished_at: now(), seconds: 0 });
      state.history = state.history.slice(0, 30);
    }

    // competitors' last week on Instagram, kept fresh in the background
    if (igSyncDue()) {
      const r = await syncCompetitorInstagram(7).catch((e: Error) => ({ saved: 0, errors: [e.message] }));
      if (r.saved || r.errors.length) {
        state.history.unshift({ id: "", kind: "instagram", label: r.saved ? `Saved ${r.saved} new competitor post${r.saved === 1 ? "" : "s"} from Instagram` : "Checked competitors' Instagram", ok: !r.errors.length, error: r.errors[0] || "", started_at: now(), finished_at: now(), seconds: 0 });
        state.history = state.history.slice(0, 30);
      }
    }

    // our own numbers, so the results page fills itself
    if (insightsDue()) {
      const r = await syncOwnInstagram().catch((e: Error) => ({ stored: 0, matched: 0, errors: [e.message] }));
      if (r.stored || r.errors.length) {
        state.history.unshift({ id: "", kind: "insights", label: r.stored ? `Read ${r.stored} of our own posts${r.matched ? `, ${r.matched} matched to Circuit` : ""}` : "Checked our own Instagram numbers", ok: !r.errors.length, error: r.errors[0] || "", started_at: now(), finished_at: now(), seconds: 0 });
        state.history = state.history.slice(0, 30);
      }
    }

    // anything dropped in the briefing folder, taken as soon as it appears
    const { waiting, takeFromFolder } = await import("@/lib/intelinbox");
    if (waiting().length) {
      const r = await takeFromFolder().catch((e: Error) => ({ taken: [], errors: [e.message] }));
      if (r.taken.length || r.errors.length) {
        state.history.unshift({ id: "", kind: "intel", label: r.taken.length ? `Took the briefing for ${r.taken.map((t) => t.date).join(", ")}` : "Could not take the briefing from the folder", ok: !r.errors.length, error: r.errors[0] || "", started_at: now(), finished_at: now(), seconds: 0 });
        state.history = state.history.slice(0, 30);
      }
    }

    // pop-ups for what has become true: a routine waiting, work due tomorrow or late
    if (Date.now() - (notesSwept.get(brandName) || 0) > 5 * 60 * 1000) {
      notesSwept.set(brandName, Date.now());
      const { sweepNotifications } = await import("@/lib/notify");
      try { sweepNotifications(); } catch { /* the next pass tries again */ }
    }

    // the work board follows the calendar and closes what is resolved, once an hour per brand
    if (Date.now() - (boardSynced.get(brandName) || 0) > 3600000) {
      boardSynced.set(brandName, Date.now());
      const { syncWork } = await import("@/lib/workplan");
      try { syncWork(); } catch { /* the next pass tries again */ }
    }

    // routines that are due: the morning check, the weekly review, anything the owner scheduled
    seedWorkflows();
    for (const wf of dueWorkflows()) {
      const r = await runWorkflow(wf.id).then((run) => ({ ok: run.status !== "failed", status: run.status })).catch((e: Error) => ({ ok: false, status: e.message }));
      state.history.unshift({ id: "", kind: "workflow", label: `${wf.name}: ${r.status === "waiting" ? "waiting for you" : r.status}`, ok: r.ok, error: r.ok ? "" : String(r.status), started_at: now(), finished_at: now(), seconds: 0 });
      state.history = state.history.slice(0, 30);
      break; // one routine per pass, so a long one never blocks the rest of the queue
    }

    // drafts first: someone is usually watching the page for them
    const renders = ((await api("GET", "/api/render?status=queued&provider=chatgpt")) as RenderJob[]).reverse();
    if (renders[0]) {
      await renderOne(renders[0]);
      /* Come straight back rather than waiting for the interval — but only after every brand
         has had its turn, which is why this returns from the brand's pass, not the tick. */
      setTimeout(() => { tick().catch(() => null); }, 1000);
      return;
    }
    // one job per pass, most foundational kind first, oldest first within a kind
    const jobs = (await api("GET", "/api/research?status=queued")) as Job[];
    const next = jobs.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))[0];
    if (next) {
      await runOne(next);
      // more may be waiting: go straight on instead of waiting for the next interval
      setTimeout(() => { tick().catch(() => null); }, 1000);
    }
  } catch (e) {
    /* A failed pass is named as one. Calling it "Checking the queue" made ten crashes in a row
       read like ten routine checks, which is how a broken queue went unnoticed for a week.
       With more than one brand it says which brand, because "couldn't check the queue" three
       times over tells you nothing about which books are stuck. */
    state.history.unshift({ id: "", kind: "check", label: tag("Couldn't check the queue"), ok: false, error: (e as Error).message, started_at: now(), finished_at: now(), seconds: 0 });
    state.history = state.history.slice(0, 30);
  }
}

const boardSynced = new Map<string, number>();
const notesSwept = new Map<string, number>();

export function kickWorker() {
  if (process.env.CIRCUIT_WORKER === "0") return;
  setTimeout(() => { tick().catch(() => null); }, 500);
}

export function startWorker() {
  /* CIRCUIT_WORKER=0 keeps a copy of Circuit from doing anything on its own — no routines, no
     emails, no ChatGPT runs. A test copy started with it on the real database would otherwise
     send the real morning briefing to the real people. */
  if (process.env.CIRCUIT_WORKER === "0") return;
  if (state.timer) return;
  state.timer = setInterval(() => { tick().catch(() => null); }, 20000);
  kickWorker();
}
