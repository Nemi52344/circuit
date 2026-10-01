import { getDb, now } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { getBrandProfile, getSiteCrawl } from "@/lib/brandsite";
import { getConversation, slotsNeedingIdeas } from "@/lib/conversation";
import { keyDatesBetween } from "@/lib/dates";
import { getPlan } from "@/lib/plan";
import { getCompetitors } from "@/lib/sources";
import { knowledgeBrief } from "@/lib/knowledge";

const shift = (key: string, days: number) => { const d = new Date(`${key}T00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
import { handle, ok, bad, readJson } from "@/lib/http";

import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
// queuing work wakes the automatic worker
startWorker();

/* The research queue a Claude session drains. Each job carries everything needed to write
   the analysis without opening the app: topic, pillar, platforms, brand and the gathered signals. */
export const GET = handle(async (req) => {
  const status = new URL(req.url).searchParams.get("status");
  const rows = getDb()
    .prepare(
      `SELECT j.id, j.slot_id, j.kind, j.status, j.error, j.payload, j.created_at, s.topic, s.platforms, s.date, s.format, s.research, p.name AS pillar, p.description AS pillar_description, p.examples AS pillar_examples
       FROM research_jobs j LEFT JOIN slots s ON s.id = j.slot_id LEFT JOIN pillars p ON p.id = s.pillar_id
       ${status ? "WHERE j.status = ?" : ""} ORDER BY j.created_at`,
    )
    .all(...(status ? [status] : [])) as { research: string; platforms: string }[];
  const brand = getBrand();
  return ok(rows.map((r) => {
    let research: Record<string, unknown> = {};
    try { research = JSON.parse(r.research || "{}"); } catch { research = {}; }
    const { research: _drop, platforms, payload: rawPayload, ...rest } = r as Record<string, unknown> & { research: string; platforms: string; payload: string };
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(rawPayload || "{}"); } catch { payload = {}; }
    const kind = (rest as { kind?: string }).kind;
    if (kind === "brand") {
      return { id: rest.id, kind, status: rest.status, created_at: rest.created_at, website: payload.website, brand: getBrand(), site: getSiteCrawl(), competitors: getCompetitors().map((c) => ({ name: c.name, website: c.website, instagram: c.instagram })) };
    }
    if (kind === "ideas") {
      const month = String(payload.month || "");
      const [yy, mm] = month.split("-").map(Number);
      const monthEnd = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
      const t0 = new Date();
      const today = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, "0")}-${String(t0.getDate()).padStart(2, "0")}`;
      const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const open = getDb().prepare(
        `SELECT s.id, s.date, s.platforms, p.name AS pillar, p.description AS pillar_description FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id
         WHERE s.id IN (${slotsNeedingIdeas(month).map(() => "?").join(",") || "''"}) ORDER BY s.date`,
      ).all(...slotsNeedingIdeas(month)) as { id: string; date: string; platforms: string; pillar: string | null; pillar_description: string | null }[];
      const used = (getDb().prepare("SELECT topic FROM slots WHERE TRIM(topic) != ''").all() as { topic: string }[]).map((x) => x.topic);
      return {
        id: rest.id, kind, status: rest.status, created_at: rest.created_at, month,
        brand: getBrand(), profile: getBrandProfile(), conversation: getConversation(month), plan_day_pillars: getPlan().day_pillars,
        learned_so_far: knowledgeBrief(24),
        key_dates: keyDatesBetween(`${month}-01`, monthEnd),
        upcoming_key_dates: keyDatesBetween(today, monthEnd),
        slots: open.map((s) => ({ slot_id: s.id, date: s.date, weekday: DOW[new Date(`${s.date}T00:00`).getDay()], pillar: s.pillar, pillar_description: s.pillar_description, platforms: JSON.parse(s.platforms || "[]"), key_dates_near: keyDatesBetween(shift(s.date, -2), shift(s.date, 3)) })),
        used_topics: used, formats: ["image (static post)", "carousel", "video (reel)", "text"],
      };
    }
    const base = { ...rest, platforms: JSON.parse(platforms || "[]"), profile: getBrandProfile(), learned_so_far: knowledgeBrief(18), brand: { name: brand.name, tagline: brand.tagline, tone: brand.tone, audience: brand.audience, claims: brand.claims } };
    if ((rest as { kind?: string }).kind === "topics") {
      const used = (getDb().prepare("SELECT topic FROM slots WHERE TRIM(topic) != ''").all() as { topic: string }[]).map((x) => x.topic);
      let examples: string[] = [];
      try { examples = JSON.parse(String((rest as Record<string, unknown>).pillar_examples || "[]")); } catch { examples = []; }
      return { ...base, pillar_examples: examples, used_topics: used };
    }
    if (kind === "slides" || kind === "copy" || kind === "postercopy") {
      return { ...base, angle: research.angle || "", message: research.message || "", summaries: { competitor: research.summary_competitor || "", market: research.summary_market || "", riders: research.summary_topic || "" } };
    }
    return { ...base, signals: research.signals || null };
  }));
});

export const PATCH = handle(async (req) => {
  const b = await readJson<{ id?: string; status?: string; error?: string }>(req);
  if (!b.id) return bad("id required");
  if (b.status && !["queued", "running", "done", "failed"].includes(b.status)) return bad("Unknown status");
  getDb().prepare("UPDATE research_jobs SET status = COALESCE(?, status), error = COALESCE(?, error), updated_at = ? WHERE id = ?").run(b.status ?? null, b.error ?? null, now(), b.id);
  return ok({ updated: b.id });
});
