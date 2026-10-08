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
     screenshot must never end up, and the library holds plenty of those. */
  const photos = getDb().prepare(`
    SELECT id, COALESCE(NULLIF(title, ''), name) AS name
    FROM files
    WHERE brand = 1 AND mime LIKE 'image/%'
    ORDER BY created_at DESC LIMIT 60`).all();
  return ok({ templates: TEMPLATES, sizes: SIZES, photos });
});

export const POST = handle(async (req) => {
  const b = await readJson<PosterSpec & { slot_id?: string; title?: string; preview?: boolean }>(req);

  if (!TEMPLATES.some((t) => t.id === b.template)) return bad("Pick a template");
  if (!SIZES[b.size]) return bad("Pick a size");
  if (b.template === "load" && !String(b.number || "").trim()) return bad("The big-number template needs a number");
  if (b.template !== "load" && !String(b.headline || "").trim()) return bad("That template needs a headline");

  /* The preview is the same HTML the render prints, so what is on screen is what comes out —
     rather than an approximation that drifts from it one edit at a time. */
  if (b.preview) return new Response(posterHtml(b), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  return ok(await makePoster(b, { slot_id: b.slot_id || null, title: b.title }), 201);
});
