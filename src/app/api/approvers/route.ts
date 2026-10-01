import { getDb, newId, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { listApprovers } from "@/lib/approvals";

export const runtime = "nodejs";

export const GET = handle(async () => ok(listApprovers()));

export const POST = handle(async (req) => {
  const b = await readJson<{ name?: string; role?: string; email?: string; required?: boolean }>(req);
  if (!b.name?.trim()) return bad("Add the person's name");
  const id = newId();
  getDb().prepare("INSERT INTO approvers (id, name, role, email, required, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
    .run(id, b.name.trim().slice(0, 80), (b.role || "").trim().slice(0, 80), (b.email || "").trim().slice(0, 120), b.required === false ? 0 : 1, now());
  return ok({ id }, 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<{ id?: string; name?: string; role?: string; email?: string; required?: boolean; active?: boolean }>(req);
  if (!b.id) return bad("id required");
  getDb().prepare("UPDATE approvers SET name = COALESCE(?, name), role = COALESCE(?, role), email = COALESCE(?, email), required = COALESCE(?, required), active = COALESCE(?, active) WHERE id = ?")
    .run(b.name?.trim() || null, b.role ?? null, b.email ?? null, b.required === undefined ? null : b.required ? 1 : 0, b.active === undefined ? null : b.active ? 1 : 0, b.id);
  return ok({ updated: b.id });
});

/* Removing a person keeps their past decisions on record but stops asking them. */
export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  getDb().prepare("UPDATE approvers SET active = 0 WHERE id = ?").run(id);
  return ok({ removed: id });
});
