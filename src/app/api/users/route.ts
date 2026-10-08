import { handle, handleAdmin, ok, bad, readJson } from "@/lib/http";
import { listUsers, createUser, setPassword, setRole, setActive, type Role } from "@/lib/auth";

export const runtime = "nodejs";

/* The people on the system. Only an admin changes any of it.

   There is no "delete a person". Somebody who signed a post off last month is part of the
   record of why it went out, and removing them would quietly rewrite that. They are switched
   off instead: they cannot sign in, their sessions end, and their name stays where it belongs. */

export const GET = handle(async () => ok({ users: listUsers() }));

export const POST = handleAdmin(async (req) => {
  const b = await readJson<{ name?: string; email?: string; role?: Role; password?: string }>(req);
  if (!b.password) return bad("Set a password for them");
  const role: Role = b.role === "admin" ? "admin" : "marketing";
  return ok(createUser({ name: b.name || "", email: b.email || "", role, password: b.password }), 201);
});

export const PATCH = handleAdmin(async (req) => {
  const b = await readJson<{ id?: string; password?: string; role?: Role; active?: boolean }>(req);
  if (!b.id) return bad("id required");
  if (b.password !== undefined) setPassword(b.id, b.password);
  if (b.role !== undefined) setRole(b.id, b.role === "admin" ? "admin" : "marketing");
  if (b.active !== undefined) setActive(b.id, b.active);
  return ok({ users: listUsers() });
});
