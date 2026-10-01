import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { parseSlot, fillMonth, FORMATS, SLOT_STATUSES, type SlotRow } from "@/lib/slots";
import { ensureDefaults, ensureDayPillars } from "@/lib/plan";
import { nextStep } from "@/lib/nextstep";
import { approvalSummary } from "@/lib/approvals";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  ensureDefaults(fillMonth);
  ensureDayPillars();
  const month = new URL(req.url).searchParams.get("month");
  const base = `SELECT s.*, p.name AS pillar_name,
      (SELECT c.file_id FROM creations c WHERE c.id = s.final_creation_id) AS final_file_id,
      (SELECT COUNT(*) FROM creations c WHERE c.slot_id = s.id) AS draft_count,
      (SELECT j.status FROM research_jobs j WHERE j.slot_id = s.id AND j.kind = 'research' ORDER BY j.created_at DESC LIMIT 1) AS research_status,
      (SELECT j.status FROM research_jobs j WHERE j.slot_id = s.id AND j.kind = 'copy' ORDER BY j.created_at DESC LIMIT 1) AS copy_status,
      (SELECT j.status FROM research_jobs j WHERE j.slot_id = s.id AND j.kind = 'topics' ORDER BY j.created_at DESC LIMIT 1) AS topics_status,
      (SELECT COUNT(*) FROM slot_samples ss WHERE ss.slot_id = s.id) AS sample_count,
      (SELECT COUNT(*) FROM render_jobs r WHERE r.slot_id = s.id AND r.status IN ('queued','running')) AS renders_open,
      (SELECT COUNT(*) FROM slot_content sc WHERE sc.slot_id = s.id) AS content_count,
      (SELECT COUNT(*) FROM posts po WHERE po.slot_id = s.id) AS post_count,
      (SELECT COUNT(*) FROM posts po WHERE po.slot_id = s.id AND po.status = 'posted') AS posted_count
    FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id`;
  const rows = (month
    ? getDb().prepare(`${base} WHERE s.date LIKE ? ORDER BY s.date, s.time`).all(`${month}-%`)
    : getDb().prepare(`${base} ORDER BY s.date, s.time`).all()) as (SlotRow & { pillar_name: string | null })[];
  return ok(rows.map((r) => {
    const x = r as unknown as Record<string, number | string | null>;
    const slot = parseSlot(r);
    return { ...slot, next: nextStep(slot, {
      research: String(x.research_status || ""), copy: String(x.copy_status || ""), topics: String(x.topics_status || ""), samples: Number(x.sample_count), drafts: Number(x.draft_count),
      renders_open: Number(x.renders_open), content: Number(x.content_count), posts: Number(x.post_count), posted: Number(x.posted_count),
      signoff: Number(x.content_count) && !Number(x.post_count) ? approvalSummary(slot.id) : undefined,
    }) };
  }));
});

export const POST = handle(async (req) => {
  const b = await readJson<{ slots?: Record<string, unknown>[] } & Record<string, unknown>>(req);
  const list = Array.isArray(b.slots) ? b.slots : [b];
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO slots (id, date, time, platforms, pillar_id, topic, format, stage, status, source, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'planned', ?, ?, ?, ?)`,
  );
  const ids: string[] = [];
  for (const x of list) {
    const date = String(x.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("Each slot needs a date like 2026-09-30");
    const format = String(x.format || "image");
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) return bad(`Unknown format ${format}`);
    const id = newId();
    const t = now();
    ins.run(id, date, String(x.time || "10:00"), JSON.stringify(Array.isArray(x.platforms) ? x.platforms : []), (x.pillar_id as string) || null,
      String(x.topic || ""), format, String(x.source || "manual"), String(x.reason || ""), t, t);
    ids.push(id);
  }
  return ok({ ids }, 201);
});

const FIELDS = ["date", "time", "pillar_id", "topic", "format", "stage", "status", "iterations", "product_id", "model", "final_creation_id"] as const;

export const PATCH = handle(async (req) => {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b.id) return bad("id required");
  if (b.format && !FORMATS.includes(b.format as (typeof FORMATS)[number])) return bad("Unknown format");
  if (b.status && !SLOT_STATUSES.includes(b.status as (typeof SLOT_STATUSES)[number])) return bad("Unknown status");
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of FIELDS) if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(b[f] === "" && f.endsWith("_id") ? null : b[f]); }
  if (b.platforms !== undefined) { sets.push("platforms = ?"); vals.push(JSON.stringify(b.platforms)); }
  if (b.research !== undefined) {
    const cur = getDb().prepare("SELECT research FROM slots WHERE id = ?").get(b.id as string) as { research: string } | undefined;
    let merged: Record<string, unknown> = {};
    try { merged = JSON.parse(cur?.research || "{}"); } catch { merged = {}; }
    sets.push("research = ?"); vals.push(JSON.stringify({ ...merged, ...(b.research as object) }));
  }
  if (!sets.length) return bad("Nothing to update");
  sets.push("updated_at = ?"); vals.push(now());
  getDb().prepare(`UPDATE slots SET ${sets.join(", ")} WHERE id = ?`).run(...vals, b.id);
  return ok({ updated: b.id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const db = getDb();
  db.prepare("DELETE FROM slot_samples WHERE slot_id = ?").run(id);
  db.prepare("DELETE FROM slot_content WHERE slot_id = ?").run(id);
  // drafts and scheduled posts are real work; keep them, just unlink
  db.prepare("UPDATE creations SET slot_id = NULL WHERE slot_id = ?").run(id);
  db.prepare("UPDATE posts SET slot_id = NULL WHERE slot_id = ?").run(id);
  db.prepare("DELETE FROM render_jobs WHERE slot_id = ? AND status = 'queued'").run(id);
  db.prepare("DELETE FROM research_jobs WHERE slot_id = ?").run(id);
  db.prepare("DELETE FROM slots WHERE id = ?").run(id);
  return ok({ deleted: id });
});
