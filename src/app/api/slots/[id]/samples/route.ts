import { getDb, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";

export const runtime = "nodejs";

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const b = await readJson<{ inspiration_ids?: string[] }>(req);
  const ids = (b.inspiration_ids || []).filter(Boolean);
  if (!ids.length) return bad("Pick at least one sample");
  const ins = getDb().prepare("INSERT OR IGNORE INTO slot_samples (slot_id, inspiration_id, created_at) VALUES (?, ?, ?)");
  for (const iid of ids) ins.run(id, iid, now());
  return ok({ added: ids.length });
});

export const DELETE = handle(async (req, { params }) => {
  const { id } = await params;
  const iid = new URL(req.url).searchParams.get("inspiration_id");
  if (!iid) return bad("inspiration_id required");
  getDb().prepare("DELETE FROM slot_samples WHERE slot_id = ? AND inspiration_id = ?").run(id, iid);
  return ok({ removed: iid });
});
