import { handle, ok, bad, readJson } from "@/lib/http";
import { getDb } from "@/lib/db";
import { makePoster, posterHtml, TEMPLATES, SIZES, type PosterSpec } from "@/lib/poster";

export const runtime = "nodejs";
export const maxDuration = 300;

/* Making a poster inside Circuit.

   GET lists what can be made and which pictures there are to make it from. POST renders one.
   There is no prompt and no model — every word on the poster arrives in the request, which is
   the point: a template cannot invent a number. */

export const GET = handle(async () => {
  /* Only the brand's own photography. A poster is the one place a scraped competitor
     screenshot must never end up, and the library holds plenty of those.

     Circuit's own posters are excluded too. They are saved as brand images, so without this
     they came back here as "photography" — newest first, which pushed the real photographs
     past the limit and made a poster of a poster the easiest thing to click. */
  const photos = getDb().prepare(`
    SELECT id, COALESCE(NULLIF(title, ''), name) AS name
    FROM files
    WHERE brand = 1 AND mime LIKE 'image/%' AND tags NOT LIKE '%made-in-circuit%'
    ORDER BY created_at DESC LIMIT 60`).all();
  return ok({ templates: TEMPLATES, sizes: SIZES, photos });
});

export const POST = handle(async (req) => {
  const b = await readJson<PosterSpec & { slot_id?: string; title?: string; preview?: boolean }>(req);

  if (!TEMPLATES.some((t) => t.id === b.template)) return bad("Pick a template");
  if (!SIZES[b.size]) return bad("Pick a size");
  /* The preview comes first and is never validated. A blank form is a perfectly reasonable
     thing to look at — it shows you the frame you are about to fill — and refusing it left the
     studio opening on a white rectangle until you happened to type a number in the right box. */
  if (b.preview) return new Response(posterHtml(b), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  /* Each template is checked against what it actually cannot be drawn without, rather than one
     rule for all of them — a welcome card with no name is an empty circle, and a point slide
     is allowed either a figure or a claim. */
  const has = (k: keyof typeof b) => Boolean(String(b[k] ?? "").trim());
  const missing =
    b.template === "load" && !has("number") ? "a number"
    : b.template === "point" && !has("number") && !has("headline") ? "a number or a headline"
    : b.template === "welcome" && !has("name") ? "the person's name"
    : b.template === "milestone" && !has("name") && !has("number") ? "a name or a figure"
    : ["fact", "statement", "cover", "hiring", "crew"].includes(b.template) && !has("headline") ? "a headline"
    : "";
  if (missing) return bad(`That template needs ${missing}`);

  return ok(await makePoster(b, { slot_id: b.slot_id || null, title: b.title }), 201);
});
