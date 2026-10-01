import { handle, ok, bad, readJson } from "@/lib/http";
import { ensureDefaults, ensureDayPillars, applyDayPillars, getPlan, savePlan, type ContentPlan } from "@/lib/plan";
import { fillMonth, applyPlan } from "@/lib/slots";

export const runtime = "nodejs";

export const GET = handle(async () => {
  ensureDefaults(fillMonth);
  ensureDayPillars();
  return ok(getPlan());
});

export const POST = handle(async (req) => {
  const b = await readJson<Partial<ContentPlan> & { apply_month?: string }>(req);
  if (b.apply_month) {
    if (!/^\d{4}-\d{2}$/.test(b.apply_month)) return bad("apply_month must look like 2026-09");
    return ok(applyPlan(b.apply_month));
  }
  if (b.per_week !== undefined && (b.per_week < 1 || b.per_week > 7)) return bad("Posts per week must be 1 to 7");
  const keep: Partial<ContentPlan> = {};
  if (b.per_week !== undefined) keep.per_week = Math.round(b.per_week);
  if (Array.isArray(b.days)) keep.days = b.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (typeof b.time === "string" && /^\d{2}:\d{2}$/.test(b.time)) keep.time = b.time;
  if (b.platform_per_week && typeof b.platform_per_week === "object") keep.platform_per_week = b.platform_per_week;
  if (b.blog_per_month !== undefined) keep.blog_per_month = Math.max(0, Math.round(b.blog_per_month));
  let applied = 0;
  if (b.day_pillars && typeof b.day_pillars === "object") {
    keep.day_pillars = Object.fromEntries(Object.entries(b.day_pillars)
      .filter(([k, v]) => /^[0-6]$/.test(k) && Array.isArray(v))
      .map(([k, v]) => [k, (v as unknown[]).filter((x) => typeof x === "string" && x.trim()).slice(0, 3) as string[]]));
  }
  savePlan(keep);
  if (keep.day_pillars) applied = applyDayPillars().updated;
  return ok({ ...getPlan(), applied });
});
