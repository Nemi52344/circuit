import { handle, ok, bad } from "@/lib/http";
import { keyDatesBetween } from "@/lib/dates";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const from = u.searchParams.get("from") || "";
  const to = u.searchParams.get("to") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return bad("from and to must look like 2026-10-01");
  return ok(keyDatesBetween(from, to));
});
