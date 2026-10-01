import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { SLOT_PLATFORMS } from "@/lib/slots";

export const runtime = "nodejs";

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const b = await readJson<{ platform?: string; caption?: string; meta?: Record<string, string>; scheduled_at?: string }>(req);
  if (!b.platform || !SLOT_PLATFORMS.includes(b.platform as (typeof SLOT_PLATFORMS)[number])) return bad("Unknown platform");
  const db = getDb();
  const existing = db.prepare("SELECT id FROM slot_content WHERE slot_id = ? AND platform = ?").get(id, b.platform) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE slot_content SET caption = COALESCE(?, caption), meta = COALESCE(?, meta), scheduled_at = COALESCE(?, scheduled_at), updated_at = ? WHERE id = ?")
      .run(b.caption ?? null, b.meta ? JSON.stringify(b.meta) : null, b.scheduled_at ?? null, now(), existing.id);
    return ok({ id: existing.id });
  }
  const cid = newId();
  db.prepare("INSERT INTO slot_content (id, slot_id, platform, caption, meta, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(cid, id, b.platform, b.caption || "", JSON.stringify(b.meta || {}), b.scheduled_at || "", now(), now());
  db.prepare("UPDATE slots SET stage = MAX(stage, 7), updated_at = ? WHERE id = ?").run(now(), id);
  return ok({ id: cid }, 201);
});

export const DELETE = handle(async (req, { params }) => {
  const { id } = await params;
  const platform = new URL(req.url).searchParams.get("platform");
  if (!platform) return bad("platform required");
  getDb().prepare("DELETE FROM slot_content WHERE slot_id = ? AND platform = ? AND post_id IS NULL").run(id, platform);
  return ok({ removed: platform });
});
