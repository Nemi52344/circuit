import { handle, ok, bad, readJson } from "@/lib/http";
import { searchFreeImages } from "@/lib/freeimages";
import { importItems, type ImportItem } from "@/lib/sources";

export const runtime = "nodejs";

/* Search pictures you're allowed to use, by topic. */
export const GET = handle(async (req) => {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return bad("Type what the picture should show");
  return ok(await searchFreeImages(q, 24));
});

/* Save the chosen ones into Inspiration, licence and credit kept in the notes. */
export const POST = handle(async (req) => {
  const b = await readJson<{ images?: { title: string; full: string; page: string; source: string; creator: string; licence: string }[]; competitor?: string }>(req);
  const list = b.images || [];
  if (!list.length) return bad("Nothing chosen");
  const items: ImportItem[] = list.map((i) => ({
    origin: i.full,
    title: i.title || "Free picture",
    image: i.full,
    link: i.page,
    source: i.source,
    competitor: b.competitor || "",
    format: "Photo",
    notes: [i.creator ? `by ${i.creator}` : "", i.licence ? `licence ${i.licence}` : "", i.source].filter(Boolean).join(" · "),
    rights: i.licence || "",
  }));
  return ok(await importItems(items));
});
