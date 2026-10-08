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

export type Template =
  | "load" | "fact" | "statement"
  | "cover" | "point"
  | "welcome" | "milestone" | "hiring" | "crew";

export type Group = "Product" | "Carousel" | "Crew";

export const TEMPLATES: { id: Template; group: Group; name: string; what: string; needs: string[] }[] = [
  { id: "load", group: "Product", name: "Big number", what: "One figure, the product beneath it, three supporting facts.", needs: ["number", "photo"] },
  { id: "fact", group: "Product", name: "Fact card", what: "A single claim set large. No photograph — for a figure to be read, not admired.", needs: ["headline"] },
  { id: "statement", group: "Product", name: "Statement", what: "A line of copy over the product.", needs: ["headline", "photo"] },

  { id: "cover", group: "Carousel", name: "Cover slide", what: "Opens a set: the question, the product off the edge, a swipe prompt.", needs: ["headline"] },
  { id: "point", group: "Carousel", name: "Point slide", what: "One figure or claim per slide, with its source printed on it.", needs: ["headline or number"] },

  /* Crew work is a different job from selling a bike. It is read by the people in the picture
     and by the ones deciding whether to join, so the product gets out of the way and a face
     takes the middle of the frame. */
  { id: "welcome", group: "Crew", name: "Welcome", what: "A new joiner: their photograph, name and role.", needs: ["name", "role", "photo"] },
  { id: "milestone", group: "Crew", name: "Milestone", what: "Years served, a promotion, something finished. A face and a figure.", needs: ["name", "number"] },
  { id: "hiring", group: "Crew", name: "We are hiring", what: "The role, where it is, and what the work actually is.", needs: ["headline"] },
  { id: "crew", group: "Crew", name: "From the floor", what: "A line from the team, over a photograph of the work.", needs: ["headline"] },
];

export const SIZES = {
  post: { w: 1080, h: 1350, label: "Portrait post 4:5" },
  square: { w: 1080, h: 1080, label: "Square 1:1" },
  story: { w: 1080, h: 1920, label: "Story / Reel 9:16" },
  /* LinkedIn crops a 4:5 badly in the feed and shows a landscape card whole. Crew posts mostly
     live there, so the shape they are read in is worth having. */
  linkedin: { w: 1200, h: 627, label: "LinkedIn landscape" },
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
  /* The accented half of the wordmark. A product poster says "BNC Challenger"; a job ad or a
     welcome card says "BNC Motors", because neither is about the Challenger. */
  mark_tail?: string;
  footnote?: string;
  source?: string;
  /* Crew templates */
  name?: string;
  role?: string;
  place?: string;
  /* Carousel: "2 / 5" in the corner, so somebody knows whether swiping is worth it */
  counter?: string;
  prompt?: string;
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

  const src = photo ? `file://${photo.split("/").map(encodeURIComponent).join("/")}` : "";
  /* Three jobs, three framings. A product cut-out floats in the middle band; a carousel cover
     pushes it off the right edge so the words keep the left; a person is cropped round and
     sits inside the text block, because a face floated behind type is a stock photo. */
  const PERSON = ["welcome", "milestone"];
  const bike = !photo ? ""
    : PERSON.includes(spec.template) ? ""
    : spec.template === "cover" ? `<img class="bike edge" src="${src}" alt="">`
    : spec.template === "crew" || spec.template === "hiring" ? `<img class="bleed" src="${src}" alt="">`
    : `<img class="bike" src="${src}" alt="">`;
  const face = photo && PERSON.includes(spec.template)
    ? `<img class="face" src="${src}" alt="">` : "";

  /* Each template is a body, not a separate file. They share the ground, the mark, the fact
     row and the signature, which is what keeps a welcome post and a product poster looking
     like they came from the same company. */
  const num = (big = false) =>
    `<div class="num${big ? " huge" : ""}">${esc(spec.number || "")}${spec.superscript ? `<sup>${esc(spec.superscript)}</sup>` : ""}${spec.unit ? `<small>${esc(spec.unit)}</small>` : ""}</div>`;
  const eyebrow = spec.eyebrow ? `<div class="eyebrow">${esc(spec.eyebrow)}</div>` : "";

  const CREW = ["welcome", "milestone", "hiring", "crew"];
  const T = spec.template;
  const body =
    T === "load"
      ? `<div class="claim">${eyebrow}${num()}${spec.headline ? `<div class="under">${escKeep(spec.headline)}</div>` : ""}</div>`

    : T === "fact"
      ? `<div class="claim mid">${eyebrow}${spec.number ? num() : ""}${spec.headline ? `<div class="big">${escKeep(spec.headline)}</div>` : ""}</div>`

    : T === "statement"
      ? `<div class="claim mid">${eyebrow}${spec.headline ? `<div class="big">${escKeep(spec.headline)}</div>` : ""}</div>`

    /* Carousel cover: the words hold the left, the product bleeds off the right corner. Centred
       and full width it runs straight through the swipe prompt. */
    : T === "cover"
      ? `<div class="claim mid narrow">${eyebrow}
           ${spec.headline ? `<div class="big">${escKeep(spec.headline)}</div>` : ""}
           ${spec.footnote ? `<div class="say">${escKeep(spec.footnote)}</div>` : ""}
           ${spec.prompt ? `<div class="swipe">${esc(spec.prompt)}</div>` : ""}
         </div>`

    : T === "point"
      ? `<div class="claim mid">${eyebrow}
           ${spec.number ? num(true) : ""}
           ${spec.headline ? `<div class="${spec.number ? "say" : "big"}">${escKeep(spec.headline)}</div>` : ""}
         </div>`

    /* A new joiner. Their face is the subject, so it is round, centred and large, and the
       product is nowhere near it. */
    : T === "welcome"
      ? `<div class="claim mid centre">
           ${eyebrow || '<div class="eyebrow">Welcome to the crew</div>'}
           ${face}
           ${spec.name ? `<div class="person">${esc(spec.name)}</div>` : ""}
           ${spec.role ? `<div class="role">${esc(spec.role)}</div>` : ""}
           ${spec.headline ? `<div class="say centred">${escKeep(spec.headline)}</div>` : ""}
           ${spec.place ? `<div class="place">${esc(spec.place)}</div>` : ""}
         </div>`

    : T === "milestone"
      ? `<div class="claim mid centre">
           ${eyebrow}
           ${face}
           ${spec.number ? num(true) : ""}
           ${spec.name ? `<div class="person small">${esc(spec.name)}</div>` : ""}
           ${spec.role ? `<div class="role">${esc(spec.role)}</div>` : ""}
           ${spec.headline ? `<div class="say centred">${escKeep(spec.headline)}</div>` : ""}
         </div>`

    : T === "hiring"
      ? `<div class="claim mid">
           ${eyebrow || '<div class="eyebrow">We are hiring</div>'}
           ${spec.headline ? `<div class="big">${escKeep(spec.headline)}</div>` : ""}
           ${spec.place ? `<div class="role">${esc(spec.place)}</div>` : ""}
           ${spec.footnote ? `<div class="say">${escKeep(spec.footnote)}</div>` : ""}
         </div>`

    : `<div class="claim mid">${eyebrow}
         ${spec.headline ? `<div class="quote">${escKeep(spec.headline)}</div>` : ""}
         ${spec.name ? `<div class="role">${esc(spec.name)}${spec.role ? ` · ${esc(spec.role)}` : ""}</div>` : ""}
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

  /* ---- carousel ---- */
  .counter { font-family:"IBM Plex Mono",monospace; font-size:${px(14)}; letter-spacing:.2em; color:rgba(244,246,242,.45); }
  .counter b { color:#A8BF6A; font-weight:500; }
  .claim.narrow .big { max-width:11ch; }
  .say { margin-top:${px(26)}; font-size:${px(31)}; font-weight:400; line-height:1.4; max-width:19ch;
    color:rgba(244,246,242,.84); letter-spacing:-.01em; }
  .say.centred { margin-left:auto; margin-right:auto; text-align:center; max-width:24ch; }
  .swipe { margin-top:${px(26)}; font-family:"IBM Plex Mono",monospace; font-size:${px(14)};
    letter-spacing:.2em; text-transform:uppercase; color:#A8BF6A; }
  .num.huge { font-size:${px(200)}; }
  /* Off the right corner, so the words on the left are never run through. */
  .bike.edge { left:auto; right:${px(-150)}; top:auto; bottom:${px(96)}; transform:none; width:${px(760)}; }
  /* A photograph of the work, behind everything, dimmed enough to read type over. */
  .bleed { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.30; }

  /* ---- crew ---- */
  .claim.centre { text-align:center; }
  /* Round, and large enough to be a person rather than a thumbnail. */
  .face { width:${px(300)}; height:${px(300)}; border-radius:50%; object-fit:cover; display:block;
    margin:0 auto ${px(32)}; border:${px(4)} solid #A8BF6A; }
  .person { font-size:${px(72)}; font-weight:600; letter-spacing:-.035em; line-height:1.08; }
  .person.small { font-size:${px(48)}; margin-top:${px(20)}; }
  .role { margin-top:${px(12)}; font-family:"IBM Plex Mono",monospace; font-size:${px(20)};
    letter-spacing:.18em; text-transform:uppercase; color:#A8BF6A; }
  .place { margin-top:${px(22)}; font-family:"IBM Plex Mono",monospace; font-size:${px(14)};
    letter-spacing:.18em; text-transform:uppercase; color:rgba(244,246,242,.45); }
  .quote { font-size:${px(54)}; font-weight:500; line-height:1.26; letter-spacing:-.025em; max-width:20ch; }
  .quote::before { content:"\\201C"; color:#A8BF6A; }
  .quote::after { content:"\\201D"; color:#A8BF6A; }

  /* A landscape card has half the height, so the type that works in a 4:5 overruns it. */
  ${w > h ? `.num { font-size:${px(150)}; } .num.huge { font-size:${px(160)}; }
    .big { font-size:${px(54)}; max-width:22ch; } .person { font-size:${px(52)}; }
    .face { width:${px(190)}; height:${px(190)}; margin-bottom:${px(20)}; }
    .quote { font-size:${px(42)}; } .frame { padding:${px(48)} ${px(56)}; }` : ""}
</style></head><body>
  <div class="glow"></div><div class="grid"></div>
  ${bike}
  <div class="frame">
    <div class="top">
      <div class="mark">${esc(spec.mark || "BNC")} <i>${esc(spec.mark_tail || (CREW.includes(spec.template) ? "Motors" : "Challenger"))}</i></div>
      ${spec.counter ? `<div class="counter">${esc(spec.counter)}</div>`
        : spec.footnote && !["cover", "hiring"].includes(spec.template) ? `<div class="kicker">${esc(spec.footnote)}</div>` : ""}
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
