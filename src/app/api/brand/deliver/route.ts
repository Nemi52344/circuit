import { getDb, setSetting, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import type { BrandProfile } from "@/lib/brandsite";

export const runtime = "nodejs";

const list = (v: unknown, max = 12) => (Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, max) : []);

/* Claude's brand profile: what the brand sells, who buys, what they care about, misunderstand and complain about. */
export const POST = handle(async (req) => {
  const b = await readJson<Partial<BrandProfile> & { job_id?: string }>(req);
  if (!b.job_id) return bad("job_id required");
  const db = getDb();
  const job = db.prepare("SELECT kind FROM research_jobs WHERE id = ?").get(b.job_id) as { kind: string } | undefined;
  if (!job || job.kind !== "brand") return bad("Brand job not found", 404);
  if (!b.sells?.trim() || !b.buyers?.trim()) return bad("Deliver at least what the brand sells and who buys it");
  const profile: BrandProfile = {
    sells: b.sells.trim(), buyers: b.buyers.trim(), problem: (b.problem || "").trim(),
    cares: list(b.cares), misunderstands: list(b.misunderstands), complains: list(b.complains), competitors_talk: list(b.competitors_talk),
    competitors: list(b.competitors), keywords: list(b.keywords, 10), content_opportunities: list(b.content_opportunities),
    facts: (Array.isArray(b.facts) ? b.facts : []).filter((f) => f?.fact?.trim()).slice(0, 20).map((f) => ({ fact: f.fact.trim(), source: String(f.source || "") })),
    sources: (Array.isArray(b.sources) ? b.sources : []).filter((s) => s?.url).slice(0, 20),
    analysed_at: now(),
  };
  setSetting("brand_profile", JSON.stringify(profile));
  db.prepare("UPDATE research_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(now(), b.job_id);
  return ok({ saved: true, keywords: profile.keywords.length });
});
