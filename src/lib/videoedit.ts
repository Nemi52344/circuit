import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, getFile, saveFileBuffer, now, newId, DATA_DIR, tryFilePath } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { chromePath } from "@/lib/intelpdf";
import { runChatGptJson, codexPath } from "@/lib/chatgpt";
import { userError } from "@/lib/http";
import { cleanPlan, retime, isNoise, filterGraph, planPrompt, totalLength, esc, LENGTHS, type Line, type Plan, type Overlay } from "@/lib/videoplan";

/* The video studio: footage in, a finished reel out, queued as a post.

   Everything runs on this Mac. ffmpeg reads and cuts; Whisper (whisper.cpp, with the model in
   data/models) hears what is said, translated to English for the captions; ChatGPT looks at
   frames and the transcript and chooses the moments, the opening line, the post's caption and
   the closing call to action; Chrome draws the captions, the brand mark and the end card as
   images, because this ffmpeg was built without its text filters; and ffmpeg lays them over
   the cut and writes a 1080×1920 reel.

   The reel becomes a post on the day you pick. Videos do not wait for sign-off (that is for
   posters) — they wait for someone to press Publish, because a post on Instagram cannot be
   taken back. */

const run = promisify(execFile);
const BIN = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].find((p) => fs.existsSync(p)) || "";
const MODEL = () => [path.join(DATA_DIR, "models", "ggml-base.bin"), path.join(DATA_DIR, "models", "ggml-base.en.bin")].find((p) => fs.existsSync(p)) || "";

export type VideoOptions = { length: 15 | 30 | 60; captions: boolean; brandmark: boolean; endcard: boolean; brief: string; post_on: string; platform: string };
export type VideoJob = {
  id: string; source_file_id: string; status: "queued" | "working" | "done" | "failed"; step: string;
  options: string; plan: string; output_file_id: string; post_id: string; error: string; created_by: string; created_at: string; updated_at: string;
};

/* What this Mac can do, for the page to say plainly before anybody waits on a job that cannot run. */
export function videoTools() {
  return { ffmpeg: Boolean(BIN("ffmpeg") && BIN("ffprobe")), whisper: Boolean(BIN("whisper-cli") && MODEL()), chrome: Boolean(chromePath()), chatgpt: Boolean(codexPath()) };
}

export const listVideoJobs = (limit = 20) => getDb().prepare("SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as VideoJob[];
export const getVideoJob = (id: string) => getDb().prepare("SELECT * FROM video_jobs WHERE id = ?").get(id) as VideoJob | undefined;

export function queueVideo(sourceFileId: string, opts: Partial<VideoOptions>, by: { id: string }): VideoJob {
  const f = getFile(sourceFileId);
  if (!f || !f.mime.startsWith("video/")) throw userError("Pick a video from the library");
  if (f.kind === "inspiration") throw userError("That is another brand's video from Inspiration — only our own footage can be edited and posted");
  const tools = videoTools();
  if (!tools.ffmpeg) throw userError("ffmpeg isn't installed on this Mac — the video studio needs it");
  const length = (LENGTHS as readonly number[]).includes(Number(opts.length)) ? Number(opts.length) as VideoOptions["length"] : 30;
  const post_on = /^\d{4}-\d{2}-\d{2}$/.test(opts.post_on || "") ? opts.post_on! : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const options: VideoOptions = {
    length, captions: opts.captions !== false, brandmark: opts.brandmark !== false, endcard: opts.endcard !== false,
    brief: String(opts.brief || "").slice(0, 500), post_on, platform: opts.platform || "Instagram",
  };
  const id = newId();
  getDb().prepare("INSERT INTO video_jobs (id, source_file_id, status, step, options, created_by, created_at, updated_at) VALUES (?, ?, 'queued', 'Waiting its turn', ?, ?, ?, ?)")
    .run(id, sourceFileId, JSON.stringify(options), by.id, now(), now());
  return getVideoJob(id)!;
}

const nextQueued = () => getDb().prepare("SELECT * FROM video_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as VideoJob | undefined;

let busy = false;
/* One edit at a time — ffmpeg already uses every core. Called by the worker, and by the page
   right after queueing so nobody waits for the next tick. */
export async function workVideoQueue(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let job = nextQueued(); job; job = nextQueued()) await runVideoJob(job.id);
  } finally { busy = false; }
}

async function runVideoJob(id: string) {
  const db = getDb();
  const step = (s: string) => db.prepare("UPDATE video_jobs SET status = 'working', step = ?, updated_at = ? WHERE id = ?").run(s, now(), id);
  const job = getVideoJob(id)!;
  const opts = JSON.parse(job.options) as VideoOptions;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-video-"));
  try {
    const f = getFile(job.source_file_id);
    if (!f) throw new Error("The footage is not in the library any more");
    const input = tryFilePath(f);
    if (!fs.existsSync(input)) throw new Error("The footage is not stored in Circuit");

    step("Reading the footage");
    const probe = JSON.parse((await run(BIN("ffprobe"), ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", input])).stdout) as { format: { duration: string }; streams: { codec_type: string }[] };
    const duration = Number(probe.format.duration) || 0;
    const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
    if (duration < 3) throw new Error("That video is shorter than three seconds");

    /* What was said. Translated to English, because the captions are for an Instagram audience
       and Whisper's small model writes Hindi in the wrong script more often than not. */
    let lines: Line[] = [];
    if (hasAudio && opts.captions && videoTools().whisper) {
      step("Listening to what is said");
      const wav = path.join(work, "a.wav");
      await run(BIN("ffmpeg"), ["-v", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { timeout: 300000 });
      await run(BIN("whisper-cli"), ["-m", MODEL(), "-f", wav, "-l", "auto", "-tr", "-oj", "-of", path.join(work, "a"), "-np"], { timeout: 600000, maxBuffer: 20_000_000 });
      const j = JSON.parse(fs.readFileSync(path.join(work, "a.json"), "utf8")) as { transcription: { offsets: { from: number; to: number }; text: string }[] };
      lines = j.transcription.map((t) => ({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: t.text.trim() })).filter((l) => !isNoise(l.text));
    }

    /* Frames for ChatGPT to look at — one every few seconds, small. */
    step("Looking at the footage");
    const count = Math.min(16, Math.max(6, Math.round(duration / 5)));
    const times = Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) * duration / count) * 10) / 10);
    const frames: string[] = [];
    for (const [i, t] of times.entries()) {
      const out = path.join(work, `f${String(i).padStart(2, "0")}.jpg`);
      await run(BIN("ffmpeg"), ["-v", "error", "-y", "-ss", String(t), "-i", input, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", out]);
      if (fs.existsSync(out)) frames.push(out);
    }

    const brand = getBrand();
    let plan: Plan;
    if (codexPath()) {
      step("ChatGPT is choosing the moments");
      try {
        const raw = await runChatGptJson(planPrompt({ duration, target: opts.length, frameTimes: times, transcript: lines, brand: brand.name, brief: opts.brief }), { search: false, images: frames, timeoutMs: 6 * 60 * 1000, retryOnTimeout: false });
        plan = cleanPlan(raw, duration, opts.length);
      } catch (e) {
        console.warn(`[video] ChatGPT could not plan ${id}: ${(e as Error).message}`);
        plan = cleanPlan({}, duration, opts.length);
      }
    } else plan = cleanPlan({}, duration, opts.length);
    db.prepare("UPDATE video_jobs SET plan = ? WHERE id = ?").run(JSON.stringify(plan), id);

    /* The pictures that go on top, each drawn once by Chrome. */
    step("Drawing the captions and cards");
    const overlays: Overlay[] = [];
    const extra: string[] = [];
    const length = totalLength(plan.cuts);
    /* ChatGPT's tidied lines when it gave them (Whisper mishears; "next thread" for "next ride"),
       and none at all when the footage already has subtitles burned in — two sets on top of
       each other is worse than either. */
    const spoken = plan.lines.length ? plan.lines : lines;
    const caps = opts.captions && !plan.burned_in ? retime(spoken, plan.cuts) : [];
    for (const [i, c] of caps.entries()) {
      extra.push(await still(work, `cap${i}`, captionHtml(c.text), 1080, 420, true));
      overlays.push({ file: extra.length, start: c.start, end: c.end, x: 0, y: 1920 - 420 - 230 });
    }
    if (plan.hook) {
      extra.push(await still(work, "hook", hookHtml(plan.hook), 1080, 520, true));
      overlays.push({ file: extra.length, start: 0, end: Math.min(2.4, length), x: 0, y: 260 });
    }
    if (opts.brandmark) {
      extra.push(await still(work, "mark", markHtml(brand.name), 1080, 200, true));
      overlays.push({ file: extra.length, start: 0, end: length, x: 0, y: 40 });
    }
    let endCard: number | null = null;
    let silence: number | null = null;
    const inputs = ["-i", input, ...extra.flatMap((p) => ["-loop", "1", "-t", String(length + 0.5), "-i", p])];
    if (opts.endcard) {
      const card = await still(work, "end", endHtml(brand.name, plan.cta || "Book your test ride today", brand.website), 1080, 1920, false);
      inputs.push("-loop", "1", "-t", "2.5", "-i", card);
      endCard = extra.length + 1;
      if (hasAudio) { inputs.push("-f", "lavfi", "-t", "2.5", "-i", "anullsrc=r=44100:cl=stereo"); silence = endCard + 1; }
      else silence = endCard;
    }

    step("Cutting the reel");
    const g = filterGraph({ cuts: plan.cuts, hasAudio, overlays, endCard, silence });
    const out = path.join(work, "reel.mp4");
    await run(BIN("ffmpeg"), [
      "-v", "error", "-y", ...inputs, "-filter_complex", g.graph, "-map", `[${g.video}]`, ...(g.audio ? ["-map", `[${g.audio}]`, "-c:a", "aac", "-b:a", "128k"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ], { timeout: 20 * 60 * 1000, maxBuffer: 20_000_000 });

    /* Into the library, and onto the calendar as a post. */
    step("Saving it");
    const title = plan.hook || (f.title || f.name).replace(/\.[a-z0-9]+$/i, "");
    const saved = saveFileBuffer(fs.readFileSync(out), `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "reel"}.mp4`, "video/mp4", "generated");
    db.prepare("UPDATE files SET title = ?, tags = ?, brand = 1 WHERE id = ?").run(`Reel · ${title}`, `reel, ${opts.length}s, from ${f.title || f.name}`, saved.id);
    const caption = [plan.caption, plan.hashtags.length ? plan.hashtags.map((h) => `#${h}`).join(" ") : ""].filter(Boolean).join("\n\n");
    const postId = newId();
    db.prepare(`INSERT INTO posts (id, platform, caption, file_id, creation_id, scheduled_at, status, posted_url, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, NULL, ?, 'scheduled', '', ?, ?, ?)`)
      .run(postId, opts.platform, caption, saved.id, `${opts.post_on}T18:00`, `Reel made in the video studio from ${f.title || f.name}`, now(), now());
    db.prepare("UPDATE video_jobs SET status = 'done', step = 'Done', output_file_id = ?, post_id = ?, error = '', updated_at = ? WHERE id = ?").run(saved.id, postId, now(), id);
  } catch (e) {
    db.prepare("UPDATE video_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run((e as Error).message.slice(0, 500), now(), id);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function retryVideo(id: string) {
  getDb().prepare("UPDATE video_jobs SET status = 'queued', step = 'Waiting its turn', error = '', updated_at = ? WHERE id = ? AND status = 'failed'").run(now(), id);
}

/* ---- the pictures ---- */

async function still(work: string, name: string, html: string, w: number, h: number, clear: boolean): Promise<string> {
  const bin = chromePath();
  if (!bin) throw new Error("No Chrome or Brave on this Mac to draw the captions with");
  const page = path.join(work, `${name}.html`);
  const png = path.join(work, `${name}.png`);
  fs.writeFileSync(page, html);
  await run(bin, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${w},${h}`,
    ...(clear ? ["--default-background-color=00000000"] : []), `--screenshot=${png}`, `file://${page}`], { timeout: 60000 });
  if (!fs.existsSync(png)) throw new Error("Chrome did not draw the caption");
  return png;
}

/* Single quotes inside: this goes into a style="…" attribute, and a double quote would end it —
   which is how the first reels came out in Times. */
const FONT = "font-family:-apple-system,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif";
const page = (body: string, bg = "transparent") => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:${bg};${FONT}">${body}</body></html>`;

const captionHtml = (text: string) => page(`<div style="position:absolute;left:70px;right:70px;bottom:0;height:420px;display:flex;align-items:flex-end;justify-content:center;text-align:center">
  <span style="background:rgba(10,12,10,.74);color:#fff;font-size:56px;font-weight:700;line-height:1.32;padding:8px 22px;border-radius:16px;-webkit-box-decoration-break:clone;box-decoration-break:clone">${esc(text)}</span></div>`);

const hookHtml = (text: string) => page(`<div style="position:absolute;inset:0 60px;display:flex;align-items:center;justify-content:center;text-align:center">
  <span style="color:#fff;font-size:84px;font-weight:800;line-height:1.08;letter-spacing:-.01em;text-shadow:0 4px 28px rgba(0,0,0,.65),0 1px 3px rgba(0,0,0,.6)">${esc(text)}</span></div>`);

const markHtml = (name: string) => page(`<div style="position:absolute;top:40px;right:60px;color:#fff;font-size:38px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;text-shadow:0 2px 14px rgba(0,0,0,.6)">${esc(name)}</div>`);

const endHtml = (name: string, cta: string, site: string) => page(`<div style="width:1080px;height:1920px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;color:#fff;text-align:center">
  <div style="font-size:100px;font-weight:800;letter-spacing:.03em;text-transform:uppercase">${esc(name)}</div>
  <div style="font-size:54px;font-weight:700;color:#C9F24C;max-width:880px;line-height:1.2">${esc(cta)}</div>
  ${site ? `<div style="font-size:38px;opacity:.75">${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</div>` : ""}</div>`, "#121412");
