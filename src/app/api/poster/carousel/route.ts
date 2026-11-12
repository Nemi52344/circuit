import { handleCan, ok, bad, readJson } from "@/lib/http";
import { makePoster, SIZES, THEMES, type PosterSpec, type SizeKey, type ThemeKey } from "@/lib/poster";

/* A whole carousel in one go: the cover and every point slide, each numbered "2 / 6" so
   somebody knows whether swiping is worth it, printed by the same templates as a single poster.
   Nothing is invented — every word arrives in the request. */
export const runtime = "nodejs";
export const maxDuration = 600;

type Cover = { headline?: string; eyebrow?: string; photo_file_id?: string | null; prompt?: string };
type Point = { number?: string; unit?: string; headline?: string; source?: string; photo_file_id?: string | null };

export const POST = handleCan("create", async (req) => {
  const b = await readJson<{ size?: SizeKey; theme?: ThemeKey; cover?: Cover; points?: Point[]; title?: string; mark?: string; mark_tail?: string; site?: string }>(req);
  const size: SizeKey = b.size && SIZES[b.size] ? b.size : "post";
  const points = (b.points || []).filter((p) => (p.headline || "").trim() || (p.number || "").trim()).slice(0, 9);
  if (!(b.cover?.headline || "").trim()) return bad("The cover needs a headline — it is the question that makes people swipe");
  if (!points.length) return bad("Add at least one slide after the cover");
  const total = points.length + 1;
  /* One look for the whole set: a carousel that changes ground between slides reads as two posts. */
  const theme = THEMES.some((t) => t.id === b.theme) ? b.theme : undefined;
  const common = { size, theme, mark: b.mark, mark_tail: b.mark_tail, site: b.site };
  const specs: PosterSpec[] = [
    { ...common, template: "cover", headline: b.cover!.headline, eyebrow: b.cover!.eyebrow, photo_file_id: b.cover!.photo_file_id || null, prompt: b.cover!.prompt || "Swipe →", counter: `1 / ${total}` },
    ...points.map((p, i) => ({ ...common, template: "point" as const, number: p.number, unit: p.unit, headline: p.headline, source: p.source, photo_file_id: p.photo_file_id || null, counter: `${i + 2} / ${total}` })),
  ];
  const title = (b.title || b.cover!.headline || "Carousel").slice(0, 60);
  const files = [];
  for (const [i, spec] of specs.entries()) {
    const made = await makePoster(spec, { title: `${title} — ${i + 1} of ${total}` });
    files.push({ file_id: made.file_id, name: made.name });
  }
  return ok({ files, title }, 201);
});
