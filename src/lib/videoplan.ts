/* The arithmetic of a video edit, with nothing that runs a program.

   ChatGPT looks at frames and the transcript and says which moments to keep; Whisper says what
   was said and when. This file turns those into something ffmpeg can be trusted with: a clean,
   in-bounds list of cuts that adds up to the length asked for, the captions moved onto the new
   timeline, and the filter graph itself. No imports, so a test can check every piece of it. */

export type Cut = { start: number; end: number };
export type Line = { start: number; end: number; text: string };
export type Plan = { cuts: Cut[]; hook: string; caption: string; hashtags: string[]; cta: string; burned_in: boolean; lines: Line[] };

export const LENGTHS = [15, 30, 60] as const;
const MIN_CUT = 1.5;
const round = (n: number) => Math.round(n * 100) / 100;

/* What ChatGPT said, made safe: inside the video, in order, not overlapping, no slivers, and no
   longer than asked (a couple of seconds' grace, so a sentence is not cut mid-word). If nothing
   usable comes back, the opening of the video is used, which is at least honest. */
export function cleanCuts(raw: unknown, duration: number, target: number): Cut[] {
  const list = Array.isArray(raw) ? raw : [];
  let cuts: Cut[] = list
    .map((c) => (c && typeof c === "object" ? { start: Number((c as Cut).start), end: Number((c as Cut).end) } : null))
    .filter((c): c is Cut => c !== null && Number.isFinite(c.start) && Number.isFinite(c.end))
    .map((c) => ({ start: Math.max(0, Math.min(c.start, duration)), end: Math.max(0, Math.min(c.end, duration)) }))
    .filter((c) => c.end - c.start >= MIN_CUT)
    .sort((a, b) => a.start - b.start);
  const merged: Cut[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 0.25) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  cuts = [];
  let total = 0;
  for (const c of merged) {
    if (total >= target) break;
    const room = target + 2 - total;
    const end = c.end - c.start > room ? c.start + room : c.end;
    if (end - c.start < MIN_CUT) break;
    cuts.push({ start: round(c.start), end: round(end) });
    total += end - c.start;
  }
  if (!cuts.length) cuts = [{ start: 0, end: round(Math.min(target, duration)) }];
  return cuts;
}

export const totalLength = (cuts: Cut[]) => round(cuts.reduce((s, c) => s + (c.end - c.start), 0));

/* What was said, moved from the footage's clock to the reel's. A line that straddles a cut is
   kept for the part that survives; anything shorter than a blink is dropped. */
export function retime(lines: Line[], cuts: Cut[]): Line[] {
  const out: Line[] = [];
  let offset = 0;
  for (const c of cuts) {
    for (const l of lines) {
      const s = Math.max(l.start, c.start);
      const e = Math.min(l.end, c.end);
      if (e - s >= 0.4 && l.text.trim()) out.push({ start: round(s - c.start + offset), end: round(e - c.start + offset), text: l.text.trim() });
    }
    offset += c.end - c.start;
  }
  return out.slice(0, 40);
}

/* Whisper's own markers — [Music], (laughs), ♪ — are not captions. */
export const isNoise = (t: string) => /^\s*[[(♪*].*[\])♪*]?\s*$/.test(t) || !/[a-z0-9ऀ-෿]/i.test(t);

export type Overlay = { file: number; start: number; end: number; x: number; y: number };

/* The ffmpeg graph. Inputs: 0 is the footage, then one still image per overlay, then the end
   card (if any) and a stretch of silence to go under it. Everything is scaled and cropped to
   1080×1920 — the reel shape — and the end card is joined on last. */
export function filterGraph(o: { cuts: Cut[]; hasAudio: boolean; overlays: Overlay[]; endCard: number | null; silence: number | null }): { graph: string; video: string; audio: string } {
  const parts: string[] = [];
  const pairs: string[] = [];
  o.cuts.forEach((c, i) => {
    parts.push(`[0:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS[v${i}]`);
    if (o.hasAudio) parts.push(`[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS[a${i}]`);
    pairs.push(o.hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  parts.push(`${pairs.join("")}concat=n=${o.cuts.length}:v=1:a=${o.hasAudio ? 1 : 0}[cv]${o.hasAudio ? "[ca]" : ""}`);
  parts.push(`[cv]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[s0]`);
  let cur = "s0";
  o.overlays.forEach((ov, i) => {
    const next = `o${i}`;
    parts.push(`[${cur}][${ov.file}:v]overlay=${ov.x}:${ov.y}:enable='between(t,${ov.start},${ov.end})'[${next}]`);
    cur = next;
  });
  let audio = o.hasAudio ? "ca" : "";
  if (o.endCard !== null && o.silence !== null) {
    parts.push(`[${o.endCard}:v]scale=1080:1920,setsar=1,fps=30[ev]`);
    if (o.hasAudio) {
      parts.push(`[ca]aresample=44100[ca2]`, `[${o.silence}:a]aresample=44100[ea]`);
      parts.push(`[${cur}][ca2][ev][ea]concat=n=2:v=1:a=1[outv][outa]`);
      audio = "outa";
    } else {
      parts.push(`[${cur}][ev]concat=n=2:v=1:a=0[outv]`);
    }
    cur = "outv";
  }
  return { graph: parts.join(";"), video: cur, audio };
}

/* What ChatGPT is asked. Frames come attached, in the order their times are listed. */
export function planPrompt(o: { duration: number; target: number; frameTimes: number[]; transcript: Line[]; brand: string; brief: string }): string {
  const said = o.transcript.length
    ? o.transcript.map((l) => `[${l.start.toFixed(1)}–${l.end.toFixed(1)}] ${l.text}`).join("\n").slice(0, 6000)
    : "(no speech found)";
  return `You are the video editor for ${o.brand}, an Indian electric two-wheeler brand. Cut a ${o.target}-second Instagram reel from this footage.

The footage is ${o.duration.toFixed(1)} seconds long. Attached are frames, taken at these times (seconds), in order: ${o.frameTimes.map((t) => t.toFixed(1)).join(", ")}.
${o.brief ? `What the team wants from it: ${o.brief}\n` : ""}What is said, with times:
${said}

Return JSON only:
{"cuts":[{"start":0,"end":0}],"hook":"…","caption":"…","hashtags":["…"],"cta":"…","burned_in":false,"lines":[{"start":0,"end":0,"text":"…"}]}

Rules:
- cuts: the moments to keep, in order, adding up to about ${o.target} seconds. Start on the strongest moment — a striking shot or the best line — not on a greeting. Never cut in the middle of a sentence; use the speech times. 2 to 6 cuts.
- hook: at most 7 words, shown on screen for the first two seconds. No hashtags, no emoji.
- caption: the Instagram caption, 2 to 4 short lines, in the brand's plain confident voice. Only claim what the footage or speech shows.
- hashtags: 4 to 8, without the # sign.
- cta: at most 6 words for the closing card, e.g. "Book your test ride today".
- burned_in: true if the frames already show subtitles or captions written on the video, so no second set is added.
- lines: for every line of speech inside your cuts, the same start and end times with the text corrected into clear, natural English — fix words the transcription obviously misheard, keep the meaning, at most 12 words a line. Leave lines out entirely if burned_in is true or there is no speech.`;
}

export function cleanPlan(raw: unknown, duration: number, target: number): Plan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const words = (s: unknown, n: number) => String(s || "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");
  return {
    cuts: cleanCuts(o.cuts, duration, target),
    hook: words(o.hook, 7).replace(/[#]/g, ""),
    caption: String(o.caption || "").trim().slice(0, 1800),
    hashtags: (Array.isArray(o.hashtags) ? o.hashtags : []).map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10),
    cta: words(o.cta, 6),
    burned_in: o.burned_in === true,
    lines: (Array.isArray(o.lines) ? o.lines : [])
      .map((l) => (l && typeof l === "object" ? { start: Number((l as Line).start), end: Number((l as Line).end), text: String((l as Line).text || "").trim().slice(0, 120) } : null))
      .filter((l): l is Line => l !== null && Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start && l.end <= duration + 1 && Boolean(l.text))
      .slice(0, 60),
  };
}

/* Captions as pieces of HTML text, escaped, so a line with "<" in it cannot break the card. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
