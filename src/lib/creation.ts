import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDb, getFile, newId, now, saveFileBuffer, tryFilePath } from "@/lib/db";

const run = promisify(execFile);

/* What a picture has to survive before it is allowed out, and what shape it leaves in. */

/* ---------- CR-11: the four checks ---------- */

/* Deliberately four, and deliberately these four. They are the mistakes that actually happen:
   the wrong variant photographed, a stale logo, a caption nobody can read on a phone, and an
   image we had no right to use. A longer list gets ticked without being read. */
export const QA_CHECKS = [
  { key: "product", label: "The product is right", hint: "Correct model, correct colour, nothing from an older version." },
  { key: "logo", label: "The logo is right", hint: "Current mark, right colourway, not stretched." },
  { key: "legible", label: "The words can be read", hint: "Check it at the size it will actually be seen — on a phone, in a feed." },
  { key: "rights", label: "We are allowed to use this", hint: "Our own photography, or something licensed for this use. A competitor's image never is." },
] as const;

export type QaKey = (typeof QA_CHECKS)[number]["key"];
export type Qa = Partial<Record<QaKey, boolean>>;

export function readQa(raw: string | null | undefined): Qa {
  if (!raw) return {};
  try { const o = JSON.parse(raw) as Qa; return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

export const qaComplete = (q: Qa): boolean => QA_CHECKS.every((c) => q[c.key] === true);

export const qaOutstanding = (q: Qa): string[] =>
  QA_CHECKS.filter((c) => q[c.key] !== true).map((c) => c.label);

export function setQa(creationId: string, patch: Qa): Qa {
  const db = getDb();
  const row = db.prepare("SELECT qa FROM creations WHERE id = ?").get(creationId) as { qa: string } | undefined;
  if (!row) throw new Error("That creation is not here any more");
  const next: Qa = { ...readQa(row.qa) };
  for (const c of QA_CHECKS) if (c.key in patch) next[c.key] = Boolean(patch[c.key]);
  db.prepare("UPDATE creations SET qa = ? WHERE id = ?").run(JSON.stringify(next), creationId);
  return next;
}

/* ---------- CR-08: aspect ratio presets ---------- */

/* The four shapes anything actually goes out in. Pixel sizes are the platforms' own, so an
   export is upload-ready rather than something to resize afterwards. */
export const ASPECTS = {
  square: { w: 1080, h: 1080, label: "Square 1:1", where: "Feed, Facebook" },
  post: { w: 1080, h: 1350, label: "Portrait 4:5", where: "Instagram feed — the tallest a feed post may be" },
  story: { w: 1080, h: 1920, label: "Story 9:16", where: "Stories, Reels covers" },
  wide: { w: 1920, h: 1080, label: "Wide 16:9", where: "YouTube, blog headers, LinkedIn" },
} as const;

export type AspectKey = keyof typeof ASPECTS;

/* The band at each edge that platform furniture sits over — the caption gradient, the profile
   row, the action buttons. Text inside it is not lost, it is covered, which is worse because
   it looks fine until it is live.

   This is a guide drawn over the picture while you judge it. It is never written into the
   file: a safe-area box baked into an export is exactly the kind of thing that ends up
   published. */
export const TEXT_SAFE = {
  square: { top: 6, bottom: 10, side: 6 },
  post: { top: 6, bottom: 14, side: 6 },
  story: { top: 14, bottom: 20, side: 8 },
  wide: { top: 8, bottom: 10, side: 6 },
} as const satisfies Record<AspectKey, { top: number; bottom: number; side: number }>;

function chromePath(): string | null {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/* Fits the picture inside the preset rather than cropping to it.

   Cropping decides for you which part of a photograph matters, and it is usually wrong — the
   bike ends up with its wheel cut off. Fitting keeps the whole frame and fills the rest with
   the brand's own near-black, which is what the posters already do. The result is exactly the
   preset's dimensions, which is what the requirement asks for. */
export async function exportCreation(creationId: string, aspect: AspectKey): Promise<{ file_id: string; w: number; h: number }> {
  const size = ASPECTS[aspect];
  if (!size) throw new Error("Pick one of the four shapes");
  const db = getDb();
  const c = db.prepare("SELECT id, file_id, title FROM creations WHERE id = ?").get(creationId) as
    | { id: string; file_id: string; title: string } | undefined;
  if (!c?.file_id) throw new Error("That creation has no picture");
  const f = getFile(c.file_id);
  if (!f) throw new Error("Its picture is missing");
  const abs = tryFilePath(f);
  if (!fs.existsSync(abs)) throw new Error("Its picture is not stored in Circuit");

  const chrome = chromePath();
  if (!chrome) throw new Error("Chrome is needed to export a shape and was not found on this Mac");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-aspect-"));
  const htmlPath = path.join(dir, "page.html");
  const outPath = path.join(dir, "out.png");
  const src = `file://${abs.split("/").map(encodeURIComponent).join("/")}`;
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0;background:#0B0D0B;}
       .f{width:${size.w}px;height:${size.h}px;display:grid;place-items:center;overflow:hidden;background:#0B0D0B;}
       img{max-width:100%;max-height:100%;display:block;object-fit:contain;}
     </style><div class="f"><img src="${src}"></div>`,
  );
  try {
    await run(chrome, [
      "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      `--window-size=${size.w},${size.h}`,
      "--default-background-color=0B0D0BFF",
      "--virtual-time-budget=6000",
      `--screenshot=${outPath}`, `file://${htmlPath}`,
    ], { timeout: 120000, maxBuffer: 8_000_000 });
    if (!fs.existsSync(outPath)) throw new Error("Chrome finished without writing the export");
    const buf = fs.readFileSync(outPath);
    const base = (c.title || "creation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "creation";
    const saved = saveFileBuffer(buf, `${base}-${aspect}-${size.w}x${size.h}.png`, "image/png", "export");
    /* Filed as its own creation so it appears on the wall beside the original, with a line
       back to what it came from. */
    const id = newId();
    db.prepare(`INSERT INTO creations (id, inspiration_id, product_id, prompt, model, mode, file_id, status, title, created_at, parent_id, round)
                SELECT ?, inspiration_id, product_id, ?, 'export', 'aspect', ?, 'generated', ?, ?, id, COALESCE(round,0)
                FROM creations WHERE id = ?`)
      .run(id, `${size.label} · ${size.w}x${size.h}`, saved.id, `${c.title || "Creation"} — ${size.label}`, now(), c.id);
    return { file_id: saved.id, w: size.w, h: size.h };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------- CR-09: the words that go with the picture ---------- */

/* A caption written from the brand profile, saved as a draft linked to the creation.

   The hard rule is the one in the requirement: only approved claims appear. A model asked for
   a caption about a motorcycle will cheerfully invent a range figure, and a made-up number in
   a published post is the single most expensive mistake this app could help somebody make. So
   the prompt is given the claims the brand has actually approved and the facts Circuit has
   recorded, and is told in as many words that anything else must be written as [check]. */
export async function captionFor(creationId: string): Promise<{ draft_id: string; caption: string; hashtags: string[] }> {
  const { runChatGptJson } = await import("@/lib/chatgpt");
  const { getBrand } = await import("@/lib/brand");
  const db = getDb();

  const c = db.prepare(`SELECT c.id, c.title, c.prompt, p.name AS product, p.color AS colour, i.title AS reference, i.competitor
                        FROM creations c
                        LEFT JOIN products p ON p.id = c.product_id
                        LEFT JOIN inspirations i ON i.id = c.inspiration_id
                        WHERE c.id = ?`).get(creationId) as
    | { id: string; title: string; prompt: string; product: string | null; colour: string | null; reference: string | null; competitor: string | null }
    | undefined;
  if (!c) throw new Error("That creation is not here any more");

  const brand = getBrand();
  /* Only what somebody has already stood behind. */
  const facts = (db.prepare(`SELECT title, body, confidence FROM knowledge
                             WHERE status = 'live'
                             ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, found_at DESC
                             LIMIT 30`).all() as { title: string; body: string; confidence: string }[])
    .map((f) => [f.title, f.body].filter(Boolean).join(" — ").trim())
    .filter(Boolean);

  const prompt = [
    `Write one social caption for ${brand.name} and a set of hashtags.`,
    "",
    `Brand: ${brand.name}${brand.tagline ? ` — ${brand.tagline}` : ""}`,
    `Voice: ${brand.tone}`,
    `Who reads it: ${brand.audience}`,
    c.product ? `The picture shows: ${c.product}${c.colour ? ` in ${c.colour}` : ""}` : "",
    "",
    "APPROVED CLAIMS — the only product facts you may state:",
    brand.claims ? brand.claims : "(none recorded)",
    facts.length ? `\nRecorded facts you may also use:\n- ${facts.slice(0, 20).join("\n- ")}` : "",
    "",
    "RULES",
    "- State no number, specification, price, range, warranty or award that is not above. If the caption needs one, write [check] in its place rather than inventing it.",
    "- Never name or compare against a competitor.",
    "- Write for Indian readers. Plain, confident, no hype, no exclamation marks.",
    "- Two or three sentences at most. No emoji in the first line.",
    "- 8 to 15 hashtags, lowercase, no spaces, relevant rather than generic.",
    "",
    'Return ONLY: {"caption": "...", "hashtags": ["...", "..."]}',
  ].filter(Boolean).join("\n");

  const answer = (await runChatGptJson(prompt, { search: false, timeoutMs: 6 * 60 * 1000 })) as
    { caption?: string; hashtags?: string[] };
  const caption = (answer.caption || "").trim();
  if (!caption) throw new Error("ChatGPT returned no caption");
  const hashtags = (answer.hashtags || [])
    .map((h) => String(h).trim().replace(/^#*/, "#"))
    .filter((h) => h.length > 1)
    .slice(0, 20);

  const id = newId();
  const t = now();
  /* A draft of type "caption", pointed back at the creation — which is what the acceptance
     test asks for, and what lets the wall show a picture with its words beside it. */
  db.prepare(`INSERT INTO drafts (id, type, title, body, meta, status, created_at, updated_at)
              VALUES (?, 'caption', ?, ?, ?, 'draft', ?, ?)`)
    .run(id, c.title || "Caption", [caption, hashtags.join(" ")].filter(Boolean).join("\n\n"),
         JSON.stringify({ creation_id: c.id, hashtags }), t, t);
  return { draft_id: id, caption, hashtags };
}

/* ---------- CR-10: the same reference across every colour ---------- */

/* One reference image, run against every colour the product comes in.

   Each colour is its own product row with its own photograph, so this is N separate
   generations rather than one picture recoloured — which is the point: a recolour lies about
   what the bike looks like, and the whole purpose of keeping real product photography is that
   it does not.

   Per-item errors, because one colour failing should not cost you the other four. */
export type BatchOutcome = { product_id: string; product: string; colour: string; creation_id?: string; error?: string };

export async function batchAcrossColours(
  inspirationId: string,
  productIds: string[],
  runOne: (inspirationId: string, productId: string) => Promise<string>,
): Promise<BatchOutcome[]> {
  const db = getDb();
  const products = productIds.length
    ? (db.prepare(`SELECT id, name, color FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`).all(...productIds) as { id: string; name: string; color: string }[])
    : (db.prepare("SELECT id, name, color FROM products ORDER BY name, color").all() as { id: string; name: string; color: string }[]);
  if (!products.length) throw new Error("There are no product photos to run against");

  const out: BatchOutcome[] = [];
  for (const p of products) {
    try {
      out.push({ product_id: p.id, product: p.name, colour: p.color, creation_id: await runOne(inspirationId, p.id) });
    } catch (e) {
      out.push({ product_id: p.id, product: p.name, colour: p.color, error: (e as Error).message });
    }
  }
  return out;
}
