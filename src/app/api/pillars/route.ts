import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { ensureDefaults, listPillars } from "@/lib/plan";
import { fillMonth } from "@/lib/slots";

export const runtime = "nodejs";

export const GET = handle(async () => {
  ensureDefaults(fillMonth);
  const counts = new Map((getDb().prepare("SELECT pillar_id, COUNT(*) n FROM slots GROUP BY pillar_id").all() as { pillar_id: string; n: number }[]).map((r) => [r.pillar_id, r.n]));
  return ok(listPillars().map((p) => ({ ...p, slot_count: counts.get(p.id) || 0 })));
});

type Body = { id?: string; name?: string; description?: string; weight?: number; platforms?: string[]; examples?: string[] };

export const POST = handle(async (req) => {
  const b = await readJson<Body>(req);
  const name = (b.name || "").trim();
  if (!name) return bad("Give the pillar a name");
  const id = newId();
  getDb()
    .prepare("INSERT INTO pillars (id, name, description, weight, platforms, examples, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, name.slice(0, 80), (b.description || "").trim(), Math.min(Math.max(Number(b.weight ?? 20), 1), 100), JSON.stringify(b.platforms || ["Instagram", "Facebook"]), JSON.stringify(b.examples || []), now());
  return ok({ id, name }, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<Body>(req);
  if (!b.id) return bad("id required");
  getDb()
    .prepare("UPDATE pillars SET name = COALESCE(?, name), description = COALESCE(?, description), weight = COALESCE(?, weight), platforms = COALESCE(?, platforms), examples = COALESCE(?, examples) WHERE id = ?")
    .run(b.name ?? null, b.description ?? null, b.weight === undefined ? null : Math.min(Math.max(Number(b.weight), 1), 100),
      b.platforms ? JSON.stringify(b.platforms) : null, b.examples ? JSON.stringify(b.examples) : null, b.id);
  return ok({ updated: b.id });
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  getDb().prepare("UPDATE slots SET pillar_id = NULL WHERE pillar_id = ?").run(id);
  getDb().prepare("DELETE FROM pillars WHERE id = ?").run(id);
  return ok({ deleted: id });
});
