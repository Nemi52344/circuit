import { handle, ok, bad, readJson } from "@/lib/http";
import { suggestSlots } from "@/lib/slots";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  const b = await readJson<{ month?: string; per_week?: number }>(req);
  if (!b.month) return bad("month required");
  try {
    return ok(suggestSlots(b.month, { perWeek: b.per_week }));
  } catch (e) {
    return bad((e as Error).message);
  }
});
