import { handle, ok, bad, readJson } from "@/lib/http";
import { importItems, type ImportItem } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = handle(async (req) => {
  const b = await readJson<{ items?: ImportItem[] }>(req);
  if (!Array.isArray(b.items) || !b.items.length) return bad("Select at least one item to save");
  return ok(await importItems(b.items), 201);
});
