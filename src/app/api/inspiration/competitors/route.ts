import { newId } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { getCompetitors, setCompetitors, ensureCompetitorFolder, type Competitor } from "@/lib/sources";

export const runtime = "nodejs";

export const GET = handle(async () => ok(getCompetitors()));

export const POST = handle(async (req) => {
  const b = await readJson<Partial<Competitor>>(req);
  const name = (b.name || "").trim();
  if (!name) return bad("Competitor name is required");
  const list = getCompetitors();
  const clean = (v?: string) => (v || "").trim();
  const entry: Competitor = {
    id: b.id && list.some((c) => c.id === b.id) ? b.id : newId(),
    name,
    website: clean(b.website),
    instagram: clean(b.instagram).replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, ""),
    pinterest: clean(b.pinterest),
    folder: clean(b.folder) || name,
    notes: clean(b.notes),
  };
  const next = list.some((c) => c.id === entry.id) ? list.map((c) => (c.id === entry.id ? entry : c)) : [...list, entry];
  setCompetitors(next);
  ensureCompetitorFolder(entry.folder);
  return ok(next, 201);
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const next = getCompetitors().filter((c) => c.id !== id);
  setCompetitors(next);
  return ok(next);
});
