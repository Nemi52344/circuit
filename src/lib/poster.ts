import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, newId, now, saveFileBuffer, getFile, UPLOAD_DIR } from "@/lib/db";
import { chromePath } from "@/lib/intelpdf";

const run = promisify(execFile);

/* Posters Circuit makes itself.

   Until now the only way to get a picture out of Circuit was the render queue: a prompt goes
   to an image model and something plausible comes back, on Higgsfield credits. That is the
   right tool for a scene nobody has photographed. It is the wrong tool for a poster, where the
   job is to put a real number and a real product photograph in front of somebody — a generated
   bike is not the Challenger, and a generated number is a lie with a typeface.

   So this renders a template instead: the brand's own words and the brand's own photography,
   set in HTML and printed by the headless Chrome already on this Mac. No model, no credits,
   no queue, and the same output every time from the same input, which is what makes it a
   template rather than a roll of the dice.

   It deliberately cannot invent anything. Every string on the poster is passed in. */

export type Template = "load" | "fact" | "statement";

export const TEMPLATES: { id: Template; name: string; what: string; needs: string[] }[] = [
  { id: "load", name: "Big number", what: "One figure, the product beneath it, three supporting facts.", needs: ["number", "photo"] },
  { id: "fact", name: "Fact card", what: "A single claim set large. No photograph — for a figure that has to be read, not admired.", needs: ["headline"] },
  { id: "statement", name: "Statement", what: "A line of copy over the product. For an opening slide or a closing one.", needs: ["headline", "photo"] },
];

export const SIZES = {
  post: { w: 1080, h: 1350, label: "Portrait post 4:5" },
  square: { w: 1080, h: 1080, label: "Square 1:1" },
  story: { w: 1080, h: 1920, label: "Story / Reel 9:16" },
} as const;
export type SizeKey = keyof typeof SIZES;

export type PosterSpec = {
  template: Template;
  size: SizeKey;
  eyebrow?: string;
  number?: string;
  unit?: string;
  superscript?: string;
  headline?: string;
  /* Up to three. Each is "bold line|quiet line" — the fact and where it comes from. */
  facts?: string[];
  photo_file_id?: string | null;
  mark?: string;
  footnote?: string;
  source?: string;
};

const esc = (s: string) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Escape, then stop hyphenated words breaking across lines.

   "two-wheeler" split over two lines reads as a typo rather than a line break, and on a poster
   with six words on it that is most of the typography. The caption is somebody's typing now,
   not a string I control, so it is handled here rather than by writing the markup carefully
   once. Only hyphens between letters are protected — a dash used as punctuation still breaks. */
const escKeep = (s: string) =>
  esc(s)
    .split(/(\s+)/)
    .map((tok) => (/\w-\w/.test(tok) ? `<span class="nb">${tok}</span>` : tok))
    .join("");

/* Chrome is given a file:// page, so the photograph has to be a path it can open rather than
   an /api/files URL it would have to be signed in to fetch. */
function photoPath(fileId?: string | null): string | null {
  if (!fileId) return null;
  const row = getFile(fileId);
  if (!row) return null;
  const full = path.join(UPLOAD_DIR, row.path);
  return fs.existsSync(full) ? full : null;
}

export function posterHtml(spec: PosterSpec): string {
  const { w, h } = SIZES[spec.size] || SIZES.post;
  const photo = photoPath(spec.photo_file_id);
  const facts = (spec.facts || []).filter(Boolean).slice(0, 3);
  /* Proportional to the frame, so the same template holds at 1:1, 4:5 and 9:16 rather than
     needing a hand-tuned copy for each. */
  const u = h / 1350;
  const px = (n: number) => `${Math.round(n * u)}px`;

  const bike = photo
    ? `<img class="bike" src="file://${photo.split("/").map(encodeURIComponent).join("/")}" alt="">`
    : "";

  const body =
    spec.template === "load"
      ? `<div class="claim">
           ${spec.eyebrow ? `<div class="eyebrow">${esc(spec.eyebrow)}</div>` : ""}
           <div class="num">${esc(spec.number || "")}${spec.superscript ? `<sup>${esc(spec.superscript)}</sup>` : ""}${spec.unit ? `<small>${esc(spec.unit)}</small>` : ""}</div>
           ${spec.headline ? `<div class="under">${escKeep(spec.headline)}</div>` : ""}
         </div>`
      : spec.template === "fact"
      ? `<div class="claim mid">
           ${spec.eyebrow ? `<div class="eyebrow">${esc(spec.eyebrow)}</div>` : ""}
           ${spec.number ? `<div class="num">${esc(spec.number)}${spec.unit ? `<small>${esc(spec.unit)}</small>` : ""}</div>` : ""}
           ${spec.headline ? `<div class="big">${escKeep(spec.headline)}</div>` : ""}
         </div>`
      : `<div class="claim mid">
           ${spec.eyebrow ? `<div class="eyebrow">${esc(spec.eyebrow)}</div>` : ""}
           ${spec.headline ? `<div class="big">${escKeep(spec.headline)}</div>` : ""}
         </div>`;

  const factRow = facts.length
    ? `<div class="facts">${facts
        .map((f) => {
          const [a, b = ""] = f.split("|");
          return `<div class="fact"><b>${esc(a.trim())}</b>${b.trim() ? `<span>${esc(b.trim())}</span>` : ""}</div>`;
        })
        .join("")}</div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${w}px; height:${h}px; position:relative; overflow:hidden; background:#0A0B0A;
    font-family:"Space Grotesk",system-ui,sans-serif; color:#F4F6F2; -webkit-font-smoothing:antialiased; }
  .glow { position:absolute; inset:0; background:
    radial-gradient(${px(1100)} ${px(680)} at 72% 86%, rgba(124,142,74,.40) 0%, rgba(124,142,74,.10) 42%, transparent 72%),
    radial-gradient(${px(760)} ${px(520)} at 12% 8%, rgba(255,255,255,.055) 0%, transparent 70%); }
  .grid { position:absolute; inset:0; opacity:.055;
    background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);
    background-size:${px(90)} ${px(90)};
    -webkit-mask-image:radial-gradient(${px(900)} ${px(900)} at 50% 42%,#000 20%,transparent 78%); }
  .frame { position:absolute; inset:0; padding:${px(64)} ${px(68)}; display:flex; flex-direction:column; }
  .top { display:flex; align-items:flex-start; justify-content:space-between; }
  .mark { font-size:${px(27)}; font-weight:700; letter-spacing:-.02em; }
  .mark i { font-style:normal; color:#A8BF6A; }
  .kicker { font-family:"IBM Plex Mono",monospace; font-size:${px(13)}; letter-spacing:.20em;
    text-transform:uppercase; color:rgba(244,246,242,.52); text-align:right; line-height:1.7; white-space:pre-line; }
  .claim { margin-top:${px(44)}; }
  .claim.mid { margin-top:auto; margin-bottom:auto; }
  .eyebrow { font-family:"IBM Plex Mono",monospace; font-size:${px(14)}; letter-spacing:.22em;
    text-transform:uppercase; color:#A8BF6A; margin-bottom:${px(20)}; }
  .num { font-size:${px(188)}; font-weight:700; line-height:.82; letter-spacing:-.055em; }
  .num small { font-size:${px(66)}; font-weight:500; letter-spacing:-.02em; margin-left:${px(6)}; }
  .num sup { font-size:${px(80)}; font-weight:400; color:#A8BF6A; vertical-align:super; line-height:0; }
  .nb { white-space:nowrap; }
  .under { margin-top:${px(22)}; font-size:${px(32)}; font-weight:500; line-height:1.28; max-width:22ch; letter-spacing:-.015em; }
  .big { font-size:${px(72)}; font-weight:600; line-height:1.08; letter-spacing:-.035em; max-width:16ch; }
  /* The photograph sits in the middle band at a size where the whole vehicle reads. Cropping a
     product past recognition turns the proof into decoration. */
  .bike { position:absolute; left:50%; transform:translateX(-50%); top:${px(498)}; width:${px(1000)};
    filter:drop-shadow(0 ${px(40)} ${px(60)} rgba(0,0,0,.78)); }
  .foot { margin-top:auto; }
  .facts { display:flex; border-top:1px solid rgba(244,246,242,.16); padding-top:${px(24)}; }
  .fact { flex:1; }
  .fact + .fact { border-left:1px solid rgba(244,246,242,.16); padding-left:${px(26)}; }
  .fact b { display:block; font-size:${px(25)}; font-weight:600; letter-spacing:-.01em; }
  .fact span { display:block; margin-top:${px(7)}; font-family:"IBM Plex Mono",monospace; font-size:${px(11.5)};
    letter-spacing:.13em; text-transform:uppercase; color:rgba(244,246,242,.5); line-height:1.5; }
  .sig { margin-top:${px(30)}; display:flex; align-items:center; justify-content:space-between;
    font-family:"IBM Plex Mono",monospace; font-size:${px(12.5)}; letter-spacing:.14em;
    text-transform:uppercase; color:rgba(244,246,242,.42); }
  .sig b { color:#F4F6F2; font-weight:500; }
</style></head><body>
  <div class="glow"></div><div class="grid"></div>
  ${bike}
  <div class="frame">
    <div class="top">
      <div class="mark">${esc(spec.mark || "BNC")} <i>Challenger</i></div>
      ${spec.footnote ? `<div class="kicker">${esc(spec.footnote)}</div>` : ""}
    </div>
    ${body}
    <div class="foot">
      ${factRow}
      <div class="sig"><span>bncmotors.in</span>${spec.source ? `<span><b>${esc(spec.source)}</b></span>` : ""}</div>
    </div>
  </div>
</body></html>`;
}

export type MadePoster = { file_id: string; creation_id: string | null; name: string; width: number; height: number };

/* Render the template and put the result where the rest of Circuit expects to find a picture:
   the file store, and — when it belongs to a slot — a creation, which is what the calendar
   draws its thumbnail from. Doing only the first is what made the first attempt invisible. */
export async function makePoster(spec: PosterSpec, opts: { slot_id?: string | null; title?: string } = {}): Promise<MadePoster> {
  const bin = chromePath();
  if (!bin) throw new Error("No Chrome or Brave on this Mac to render the poster with");
  const { w, h } = SIZES[spec.size] || SIZES.post;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-poster-"));
  const htmlPath = path.join(work, "poster.html");
  const outPath = path.join(work, "poster.png");
  fs.writeFileSync(htmlPath, posterHtml(spec));

  try {
    await run(bin, [
      "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--force-device-scale-factor=1", `--window-size=${w},${h}`,
      /* Long enough for the web font to arrive. Without it Chrome shoots the fallback face and
         every line comes out the wrong width. */
      "--virtual-time-budget=8000",
      `--screenshot=${outPath}`, `file://${htmlPath}`,
    ], { timeout: 120000, maxBuffer: 8_000_000 });

    if (!fs.existsSync(outPath)) throw new Error("Chrome finished without writing the poster");
    const buf = fs.readFileSync(outPath);
    const title = opts.title || spec.headline || spec.number || "Poster";
    const name = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "poster"}.png`;
    const saved = saveFileBuffer(buf, name, "image/png", "upload");

    const db = getDb();
    db.prepare("UPDATE files SET title = ?, tags = ?, brand = 1 WHERE id = ?")
      .run(title, "poster,made-in-circuit", saved.id);

    let creation: string | null = null;
    if (opts.slot_id) {
      creation = newId();
      db.prepare(`INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, created_at, slot_id, round)
                  VALUES (?, NULL, NULL, ?, 'template', 'poster', ?, 'generated', ?, ?, ?, 1)`)
        .run(creation, `${spec.template} · ${spec.size}`, saved.id, title, now(), opts.slot_id);
      /* Only becomes the slot's picture if it has not already chosen one — making a second
         draft should not silently replace the one somebody approved. */
      const slot = db.prepare("SELECT final_creation_id FROM slots WHERE id = ?").get(opts.slot_id) as { final_creation_id: string | null } | undefined;
      if (slot && !slot.final_creation_id) {
        db.prepare("UPDATE slots SET final_creation_id = ?, updated_at = ? WHERE id = ?").run(creation, now(), opts.slot_id);
      }
    }
    return { file_id: saved.id, creation_id: creation, name, width: w, height: h };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
