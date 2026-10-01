import { nextStep } from "@/lib/nextstep";
import { approvalSummary } from "@/lib/approvals";
import { getDb, newId, now } from "@/lib/db";
import { getPlan, listPillars, pillarForDate } from "@/lib/plan";

/* A content slot is one planned piece of content on the calendar. It moves through eight stages:
   1 pillar & topic · 2 research · 3 samples · 4 first draft · 5 refine · 6 approve · 7 platform copy · 8 schedule. */

export const STAGES = [
  { n: 1, key: "topic", label: "Pillar & topic" },
  { n: 2, key: "research", label: "Research" },
  { n: 3, key: "samples", label: "Samples" },
  { n: 4, key: "draft", label: "First draft" },
  { n: 5, key: "refine", label: "Refine" },
  { n: 6, key: "approve", label: "Approve" },
  { n: 7, key: "content", label: "Platform copy" },
  { n: 8, key: "schedule", label: "Schedule" },
] as const;

export const FORMATS = ["image", "carousel", "video", "text"] as const;
export const SLOT_PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X", "Blog"] as const;
export const SLOT_STATUSES = ["planned", "in_progress", "approved", "scheduled", "posted"] as const;

export type SlotRow = {
  id: string; date: string; time: string; platforms: string; pillar_id: string | null; topic: string; format: string;
  stage: number; status: string; source: string; reason: string; research: string; iterations: number;
  product_id: string | null; model: string; final_creation_id: string | null; created_at: string; updated_at: string;
};

export function parseSlot(r: SlotRow & { pillar_name?: string | null }) {
  let platforms: string[] = [];
  let research: Record<string, unknown> = {};
  try { platforms = JSON.parse(r.platforms || "[]"); } catch { platforms = []; }
  try { research = JSON.parse(r.research || "{}"); } catch { research = {}; }
  return { ...r, platforms, research };
}

export function slotDetail(id: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT s.*, p.name AS pillar_name FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id WHERE s.id = ?")
    .get(id) as (SlotRow & { pillar_name: string | null }) | undefined;
  if (!row) return null;
  const samples = db
    .prepare(
      `SELECT i.* FROM slot_samples ss JOIN inspirations i ON i.id = ss.inspiration_id
       WHERE ss.slot_id = ? ORDER BY ss.created_at`,
    )
    .all(id);
  const drafts = db
    .prepare("SELECT c.* FROM creations c WHERE c.slot_id = ? ORDER BY c.round, c.created_at")
    .all(id);
  const jobs = db
    .prepare("SELECT id, status, round, model, error, creation_id, created_at FROM render_jobs WHERE slot_id = ? ORDER BY created_at")
    .all(id);
  const content = db.prepare("SELECT * FROM slot_content WHERE slot_id = ? ORDER BY platform").all(id);
  const slides = db.prepare("SELECT * FROM slot_slides WHERE slot_id = ? ORDER BY position, created_at").all(id);
  const slides_job = db.prepare("SELECT status, error, created_at FROM research_jobs WHERE slot_id = ? AND kind = 'slides' ORDER BY created_at DESC LIMIT 1").get(id) || null;
  const research_job = db.prepare("SELECT id, status, error, created_at, updated_at FROM research_jobs WHERE slot_id = ? AND kind = 'research' ORDER BY created_at DESC LIMIT 1").get(id) || null;
  const topics_job = db.prepare("SELECT status FROM research_jobs WHERE slot_id = ? AND kind = 'topics' ORDER BY created_at DESC LIMIT 1").get(id) as { status: string } | undefined;
  const copy_job = db.prepare("SELECT id, status, error, created_at, updated_at FROM research_jobs WHERE slot_id = ? AND kind = 'copy' ORDER BY created_at DESC LIMIT 1").get(id) || null;
  const poster_job = db.prepare("SELECT status FROM research_jobs WHERE slot_id = ? AND kind = 'postercopy' ORDER BY created_at DESC LIMIT 1").get(id) as { status: string } | undefined;
  const posts = db
    .prepare("SELECT id, platform, scheduled_at, status, posted_url, caption FROM posts WHERE slot_id = ? ORDER BY scheduled_at")
    .all(id);
  const product = row.product_id ? db.prepare("SELECT * FROM products WHERE id = ?").get(row.product_id) : null;
  const final = row.final_creation_id ? db.prepare("SELECT * FROM creations WHERE id = ?").get(row.final_creation_id) : null;
  const slot = parseSlot(row);
  const approvals = approvalSummary(id);
  const next = nextStep(slot, {
    research: (research_job as { status: string } | null)?.status || "", copy: (copy_job as { status: string } | null)?.status || "", topics: topics_job?.status || "",
    samples: samples.length, drafts: drafts.length, renders_open: (jobs as { status: string }[]).filter((j) => j.status === "queued" || j.status === "running").length,
    content: content.length, posts: posts.length, posted: (posts as { status: string }[]).filter((p) => p.status === "posted").length,
    signoff: approvals,
  });
  return { slot, samples, drafts, jobs, content, posts, product, final, research_job, copy_job, topics_job: topics_job || null, poster_job: poster_job?.status || "", slides, slides_job, approvals, next };
}

/* ---------- Suggestions: the content plan, sharpened by analytics ---------- */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type PostStat = { id: string; platform: string; scheduled_at: string; status: string; impressions: number | null; likes: number | null; comments: number | null; shares: number | null };

export type Suggestion = { date: string; time: string; platforms: string[]; pillar_id: string | null; pillar_name: string | null; reason: string };

export function suggestSlots(month: string, opts: { perWeek?: number } = {}) {
  const db = getDb();
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error("month must look like 2026-09");
  const plan = getPlan();
  const pillars = listPillars();

  // latest metric per post
  const stats = db
    .prepare(
      `SELECT po.id, po.platform, po.scheduled_at, po.status, m.impressions, m.likes, m.comments, m.shares
       FROM posts po
       LEFT JOIN metrics m ON m.id = (SELECT m2.id FROM metrics m2 WHERE m2.post_id = po.id ORDER BY m2.collected_at DESC LIMIT 1)`,
    )
    .all() as PostStat[];
  const eng = (p: PostStat) => (p.impressions ? ((p.likes || 0) + (p.comments || 0) + (p.shares || 0)) / p.impressions : null);
  const measured = stats.filter((p) => p.status === "posted" && eng(p) !== null);
  const avg = (a: number[]) => a.reduce((x, v) => x + v, 0) / a.length;
  const byPlatform = new Map<string, number[]>();
  const byDow = new Map<number, number[]>();
  for (const p of measured) {
    const e = eng(p) as number;
    byPlatform.set(p.platform, [...(byPlatform.get(p.platform) || []), e]);
    const d = new Date(p.scheduled_at).getDay();
    byDow.set(d, [...(byDow.get(d) || []), e]);
  }
  const dataDriven = measured.length >= 3;
  const bestPlatforms = [...byPlatform.entries()].map(([k, v]) => ({ k, e: avg(v), n: v.length })).sort((a, b) => b.e - a.e);
  const bestDows = [...byDow.entries()].map(([k, v]) => ({ k, e: avg(v), n: v.length })).sort((a, b) => b.e - a.e);

  const perWeek = Math.min(Math.max(opts.perWeek || plan.per_week || 4, 1), 7);
  const ranked = dataDriven ? bestDows.map((d) => d.k) : [];
  const FALLBACK = [...plan.days, 2, 4, 6, 1, 3, 5, 0];
  const dayOrder = Array.from(new Set([...ranked, ...FALLBACK]));
  const pickDays = dayOrder.slice(0, perWeek);

  const existing = new Set((db.prepare("SELECT date FROM slots WHERE date LIKE ?").all(`${month}-%`) as { date: string }[]).map((r) => r.date));
  const blogUsed = (db.prepare("SELECT COUNT(*) n FROM slots WHERE date LIKE ? AND platforms LIKE '%Blog%'").get(`${month}-%`) as { n: number }).n;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const daysInMonth = new Date(y, m, 0).getDate();

  // smooth weighted round robin: over the month each pillar gets its share, never bunched
  const totalW = pillars.reduce((a, p) => a + Math.max(p.weight, 1), 0) || 1;
  const credit = new Map(pillars.map((p) => [p.id, 0]));
  const nextPillar = () => {
    if (!pillars.length) return null;
    for (const p of pillars) credit.set(p.id, (credit.get(p.id) || 0) + Math.max(p.weight, 1));
    const best = pillars.reduce((a, b) => ((credit.get(b.id) || 0) > (credit.get(a.id) || 0) ? b : a));
    credit.set(best.id, (credit.get(best.id) || 0) - totalW);
    return best;
  };

  const out: Suggestion[] = [];
  let blogCount = blogUsed;
  const weekUse = new Map<string, Record<string, number>>();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m - 1, d);
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (key < todayKey || existing.has(key) || !pickDays.includes(date.getDay())) continue;

    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const wk = monday.toISOString().slice(0, 10);
    const used = weekUse.get(wk) || {};

    const dayPillar = pillarForDate(key, pillars, plan);
    const pillar = dayPillar || nextPillar();
    const allowed = pillar?.platforms.length ? pillar.platforms : ["Instagram", "Facebook"];
    let platforms = allowed.filter((pl) => {
      if (pl === "Blog") return blogCount < plan.blog_per_month;
      const quota = plan.platform_per_week[pl];
      return quota === undefined ? true : (used[pl] || 0) < quota;
    });
    if (dataDriven && bestPlatforms[0] && !platforms.includes(bestPlatforms[0].k) && bestPlatforms[0].k !== "Blog") platforms.unshift(bestPlatforms[0].k);
    if (!platforms.length) platforms = ["Instagram"];
    for (const pl of platforms) used[pl] = (used[pl] || 0) + 1;
    if (platforms.includes("Blog")) blogCount++;
    weekUse.set(wk, used);

    const share = pillar ? Math.round((Math.max(pillar.weight, 1) / totalW) * 100) : 0;
    const dow = bestDows.find((x) => x.k === date.getDay());
    const reason = dataDriven
      ? `${DOW[date.getDay()]} averages ${((dow?.e ?? 0) * 100).toFixed(1)}% engagement over ${dow?.n ?? 0} post${(dow?.n ?? 0) === 1 ? "" : "s"}${bestPlatforms[0] ? `; ${bestPlatforms[0].k} performs best` : ""}.${pillar ? ` ${pillar.name} is ${share}% of the plan.` : ""}`
      : `${dayPillar ? `${DOW[date.getDay()]} is for ${dayPillar.name}. ` : pillar ? `${pillar.name}, ${share}% of your plan. ` : ""}${perWeek} posts a week on ${pickDays.map((x) => DOW[x]).join(", ")}.`;
    out.push({ date: key, time: plan.time || "10:00", platforms, pillar_id: pillar?.id ?? null, pillar_name: pillar?.name ?? null, reason });
  }
  return { suggestions: out, perWeek, dataDriven, measuredPosts: measured.length };
}

/* Adds the suggested slots for a month to the calendar. Used once on first run. */
export function fillMonth(month: string) {
  const { suggestions } = suggestSlots(month);
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO slots (id, date, time, platforms, pillar_id, topic, format, stage, status, source, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', 'image', 1, 'planned', 'suggested', ?, ?, ?)`,
  );
  for (const x of suggestions) ins.run(newId(), x.date, x.time, JSON.stringify(x.platforms), x.pillar_id, x.reason, now(), now());
  return suggestions.length;
}

/* Fills in blanks on slots that already exist, without adding or removing any.
   Only touches slots nobody has started: no pillar, no topic, still at stage 1.
   Platforms and time are only set on slots the suggester created, never on ones added by hand. */
export function applyPlan(month: string) {
  const db = getDb();
  const plan = getPlan();
  const pillars = listPillars();
  if (!pillars.length) return { updated: 0 };
  const targets = db
    .prepare("SELECT id, date, source, platforms FROM slots WHERE date LIKE ? AND pillar_id IS NULL AND topic = '' AND stage = 1 ORDER BY date, time")
    .all(`${month}-%`) as { id: string; date: string; source: string; platforms: string }[];

  const totalW = pillars.reduce((a, p) => a + Math.max(p.weight, 1), 0) || 1;
  const credit = new Map(pillars.map((p) => [p.id, 0]));
  const nextPillar = () => {
    for (const p of pillars) credit.set(p.id, (credit.get(p.id) || 0) + Math.max(p.weight, 1));
    const best = pillars.reduce((a, b) => ((credit.get(b.id) || 0) > (credit.get(a.id) || 0) ? b : a));
    credit.set(best.id, (credit.get(best.id) || 0) - totalW);
    return best;
  };
  let blogCount = (db.prepare("SELECT COUNT(*) n FROM slots WHERE date LIKE ? AND platforms LIKE '%Blog%'").get(`${month}-%`) as { n: number }).n;
  const weekUse = new Map<string, Record<string, number>>();
  const upd = db.prepare("UPDATE slots SET pillar_id = ?, platforms = ?, time = ?, reason = ?, updated_at = ? WHERE id = ?");
  const updPillarOnly = db.prepare("UPDATE slots SET pillar_id = ?, updated_at = ? WHERE id = ?");

  let updated = 0;
  for (const t of targets) {
    const [y, m, d] = t.date.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const wk = `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
    const used = weekUse.get(wk) || {};
    const pillar = nextPillar();
    if (t.source !== "suggested") {
      updPillarOnly.run(pillar.id, now(), t.id);
      updated++;
      continue;
    }
    let platforms = (pillar.platforms.length ? pillar.platforms : ["Instagram", "Facebook"]).filter((pl) => {
      if (pl === "Blog") return blogCount < plan.blog_per_month;
      const quota = plan.platform_per_week[pl];
      return quota === undefined ? true : (used[pl] || 0) < quota;
    });
    if (!platforms.length) platforms = ["Instagram"];
    for (const pl of platforms) used[pl] = (used[pl] || 0) + 1;
    if (platforms.includes("Blog")) blogCount++;
    weekUse.set(wk, used);
    const share = Math.round((Math.max(pillar.weight, 1) / totalW) * 100);
    upd.run(pillar.id, JSON.stringify(platforms), plan.time || "18:30", `${pillar.name}, ${share}% of your plan.`, now(), t.id);
    updated++;
  }
  return { updated };
}
