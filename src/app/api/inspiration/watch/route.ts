import { newId } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { getWatchlist, setWatchlist, type SourceKind } from "@/lib/sources";

export const runtime = "nodejs";
const KINDS: SourceKind[] = ["pinterest", "instagram", "website", "reddit"];

export const GET = handle(async () => ok(getWatchlist()));

export const POST = handle(async (req) => {
  const b = await readJson<{ kind?: string; label?: string; input?: string }>(req);
  const kind = b.kind as SourceKind;
  const input = (b.input || "").trim();
  if (!KINDS.includes(kind)) return bad("Unknown source kind");
  if (!input) return bad("Nothing to watch");
  const list = getWatchlist();
  if (list.some((w) => w.kind === kind && w.input === input)) return ok(list);
  const label = (b.label || "").trim() || input.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 40);
  const next = [...list, { id: newId(), kind, label, input }];
  setWatchlist(next);
  return ok(next, 201);
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const next = getWatchlist().filter((w) => w.id !== id);
  setWatchlist(next);
  return ok(next);
});
