import { handle, ok } from "@/lib/http";
import { dashboard } from "@/lib/reports";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  const n = Number(new URL(req.url).searchParams.get("months") || 12);
  return ok(dashboard(Math.min(Math.max(n, 3), 24)));
});
