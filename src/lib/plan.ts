import { getDb, getSetting, setSetting, newId, now } from "@/lib/db";

/* Starting content strategy for BNC Motors, so a fresh install already knows what to post,
   where and how often. Every number here is a default the owner can change, and the calendar
   switches to learned days and platforms once real results exist. */

export type PillarSeed = { name: string; description: string; weight: number; platforms: string[]; examples: string[] };

export const DEFAULT_PILLARS: PillarSeed[] = [
  {
    name: "Product & tech",
    description: "What the Challenger 110 is and does: design, battery, range, features.",
    weight: 25,
    platforms: ["Instagram", "Facebook", "X"],
    examples: ["Challenger 110 feature spotlight", "How the battery handles the monsoon", "Design details up close", "Range on a real city commute"],
  },
  {
    name: "Savings & EV education",
    description: "Running cost against petrol, charging at home, battery myths, government subsidies.",
    weight: 25,
    platforms: ["Instagram", "Facebook", "LinkedIn", "Blog"],
    examples: ["Petrol vs electric: a month's running cost", "Charging at home, explained", "Five EV battery myths", "What an EV subsidy is worth to you"],
  },
  {
    name: "Rider stories",
    description: "Customer testimonials, real owners, their routes and reasons. Reposts and customer features.",
    weight: 20,
    platforms: ["Instagram", "Facebook"],
    examples: ["Owner spotlight: a daily commuter", "Delivery rider's week on the Challenger", "Why I switched to electric", "Rider photo of the week"],
  },
  {
    name: "Ownership & service",
    description: "Warranty, service network, maintenance tips, what owning one is really like.",
    weight: 15,
    platforms: ["Instagram", "Facebook", "X"],
    examples: ["Monsoon care checklist", "What the battery warranty covers", "Find your nearest service point", "Three maintenance habits"],
  },
  {
    name: "Brand & behind the scenes",
    description: "Factory, team, Nemi, dealers, events, launches and offers.",
    weight: 15,
    platforms: ["Instagram", "LinkedIn", "Facebook"],
    examples: ["Inside the assembly line", "Meet the team building it", "New dealer opening", "Fleet partner announcement"],
  },
];

export type ContentPlan = {
  per_week: number;
  days: number[]; // 0 Sunday … 6 Saturday
  time: string;
  platform_per_week: Record<string, number>;
  blog_per_month: number;
  basis: { label: string; url: string }[];
  notes: string;
  /* weekday (0 Sunday … 6 Saturday) → pillar names; two names alternate week by week */
  day_pillars: Record<string, string[]>;
};

export const DEFAULT_PLAN: ContentPlan = {
  per_week: 4,
  days: [1, 3, 5, 0], // Mon, Wed, Fri, Sun: an even spread until your own results say otherwise
  time: "18:30",
  platform_per_week: { Instagram: 4, Facebook: 4, LinkedIn: 2, X: 2 },
  blog_per_month: 2,
  day_pillars: {
    "0": ["Brand & behind the scenes", "Ownership & service"],
    "1": ["Product & tech"],
    "2": ["Ownership & service"],
    "3": ["Savings & EV education"],
    "4": ["Brand & behind the scenes"],
    "5": ["Rider stories"],
    "6": ["Product & tech", "Savings & EV education"],
  },
  basis: [
    { label: "Sprout Social and SocialPilot: Friday is among the strongest engagement days on Instagram and Facebook. Testimonials on Friday is a common convention, not a measured rule", url: "https://sproutsocial.com/insights/best-times-to-post-on-social-media/" },
    { label: "Hootsuite: 3–5 Instagram and 2–5 LinkedIn posts a week as a starting cadence", url: "https://blog.hootsuite.com/social-media-benchmarks/" },
    { label: "Buffer: engagement across 52M posts, posting more is not always better", url: "https://buffer.com/resources/state-of-social-media-engagement-2026/" },
    { label: "Devtrios: automotive pillars; owner and community posts earn about 2.3× the comments", url: "https://devtrios.com/blog/automotive-social-media-marketing-strategies-trends-and-best-practices/" },
    { label: "KORTX: EV marketing leans on education about charging, batteries and ownership", url: "https://kortx.io/news/electric-vehicle-marketing/" },
  ],
  notes:
    "Four original posts a week, each cross-posted to Instagram and Facebook, with LinkedIn and X on the pieces that suit them and two blog articles a month. Benchmarks suggest far more for Facebook and X; this is scaled to what one person can make well. Days and time are an even spread, not a researched claim, and are replaced by your best days once three posts have results.",
};

export function getPlan(): ContentPlan {
  const raw = getSetting("content_plan");
  if (!raw) return DEFAULT_PLAN;
  try {
    return { ...DEFAULT_PLAN, ...(JSON.parse(raw) as Partial<ContentPlan>) };
  } catch {
    return DEFAULT_PLAN;
  }
}
export function savePlan(p: Partial<ContentPlan>) {
  setSetting("content_plan", JSON.stringify({ ...getPlan(), ...p }));
}

/* The pillar a date should carry under the weekday plan, or null when that day has none. */
export function pillarForDate(dateKey: string, pillars: PillarRow[], plan: ContentPlan = getPlan()): PillarRow | null {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const names = (plan.day_pillars || DEFAULT_PLAN.day_pillars)[String(date.getDay())] || [];
  if (!names.length) return null;
  const week = Math.floor((date.getTime() - new Date(2026, 0, 5).getTime()) / (7 * 86400000));
  const name = names[((week % names.length) + names.length) % names.length];
  return pillars.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()) || null;
}

/* Gives every upcoming post nobody has started the pillar its weekday calls for.
   A post whose pillar changes loses its old topic ideas so fresh ones are made for the new pillar. */
export function applyDayPillars(fromKey?: string) {
  const db = getDb();
  const plan = getPlan();
  const pillars = listPillars();
  const t = new Date();
  const from = fromKey || `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const rows = db.prepare("SELECT id, date, pillar_id, research FROM slots WHERE date >= ? AND stage = 1 AND TRIM(topic) = ''").all(from) as { id: string; date: string; pillar_id: string | null; research: string }[];
  let updated = 0;
  for (const r of rows) {
    const p = pillarForDate(r.date, pillars, plan);
    if (!p || p.id === r.pillar_id) continue;
    let research: Record<string, unknown> = {};
    try { research = JSON.parse(r.research || "{}"); } catch { research = {}; }
    delete research.topic_ideas;
    delete research.topic_ideas_at;
    db.prepare("UPDATE slots SET pillar_id = ?, research = ?, updated_at = ? WHERE id = ?").run(p.id, JSON.stringify(research), now(), r.id);
    updated++;
  }
  return { updated };
}

/* One-time upgrade for installs made before weekday pillars existed. */
export function ensureDayPillars() {
  if (getSetting("day_pillars_v1")) return;
  const plan = getPlan();
  if (!plan.day_pillars || !Object.keys(plan.day_pillars).length) savePlan({ day_pillars: DEFAULT_PLAN.day_pillars });
  if (!plan.basis.some((b) => b.url.includes("sproutsocial"))) savePlan({ basis: [DEFAULT_PLAN.basis[0], ...plan.basis] });
  getDb().prepare("UPDATE pillars SET description = ? WHERE name = 'Rider stories' AND description = ?")
    .run(DEFAULT_PILLARS[2].description, "Real owners, their routes and reasons. Reposts and customer features.");
  applyDayPillars();
  setSetting("day_pillars_v1", now());
}

export type PillarRow = { id: string; name: string; description: string; weight: number; platforms: string[]; examples: string[] };
export function listPillars(): PillarRow[] {
  const rows = getDb().prepare("SELECT id, name, description, weight, platforms, examples FROM pillars ORDER BY created_at").all() as
    { id: string; name: string; description: string; weight: number; platforms: string; examples: string }[];
  const j = (v: string) => { try { return JSON.parse(v || "[]") as string[]; } catch { return []; } };
  return rows.map((r) => ({ ...r, platforms: j(r.platforms), examples: j(r.examples) }));
}

/* First run only: seed the pillars and fill the calendar from today to the end of next month.
   A flag stops it ever running again, so deleting everything stays deleted. */
export function ensureDefaults(fillMonth: (month: string) => void) {
  if (getSetting("defaults_seeded")) return false;
  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) n FROM pillars").get() as { n: number }).n;
  if (!count) {
    const ins = db.prepare("INSERT INTO pillars (id, name, description, weight, platforms, examples, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    DEFAULT_PILLARS.forEach((p, i) => {
      // stagger created_at so the listing keeps this order
      ins.run(newId(), p.name, p.description, p.weight, JSON.stringify(p.platforms), JSON.stringify(p.examples), new Date(Date.now() + i).toISOString());
    });
  }
  if (!getSetting("content_plan")) savePlan({});
  const d = new Date();
  const thisMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const nx = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const nextMonth = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, "0")}`;
  fillMonth(thisMonth);
  fillMonth(nextMonth);
  setSetting("defaults_seeded", now());
  return true;
}
