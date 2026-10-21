import { getDb } from "@/lib/db";

/* What has actually worked for us, as opposed to what works for the category.
   Everything upstream in Circuit — pillars, formats, the weekday rhythm — is convention plus
   competitor evidence until this file has something to say. It reads our own posted results
   (metrics, plus anything pulled from Instagram) and answers three questions: which pillar,
   which format, which day. It refuses to answer on thin data rather than guessing: fewer than
   MIN_ROWS results in a group and the group is reported as "not enough yet". */

export const MIN_ROWS = 3;

export type Cut = { key: string; label: string; posts: number; engagement: number; reach: number | null; best: string; enough: boolean };
export type Learned = {
  posts: number; with_numbers: number; from: string; to: string;
  pillars: Cut[]; formats: Cut[]; platforms: Cut[]; weekdays: Cut[];
  own_posts: number; own_formats: Cut[]; own_weekdays: Cut[]; own_standouts: Standout[]; own_average: number;
  headline: string; advice: string[];
};
export type Standout = { permalink: string; type: string; caption: string; posted_at: string; engagement: number; reach: number | null; times: number };

type Row = {
  post_id: string; platform: string; scheduled_at: string; posted_url: string;
  pillar: string | null; format: string | null; topic: string | null;
  reach: number | null; likes: number | null; comments: number | null; shares: number | null; source: string;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FORMAT_LABEL: Record<string, string> = { image: "Static post", carousel: "Carousel", video: "Video", text: "Text only" };

/* One number per post so the cuts compare like with like: the interactions a post earned.
   Reach is reported alongside but never mixed in, because it is missing on older posts. */
const engagementOf = (r: Row) => (r.likes || 0) + (r.comments || 0) + (r.shares || 0);

function rows(): Row[] {
  return getDb().prepare(`
    SELECT p.id post_id, p.platform, p.scheduled_at, p.posted_url,
           pl.name pillar, s.format, s.topic,
           m.reach, m.likes, m.comments, m.shares, m.source
      FROM posts p
      JOIN metrics m ON m.post_id = p.id
 LEFT JOIN slot_content sc ON sc.post_id = p.id
 LEFT JOIN slots s ON s.id = sc.slot_id
 LEFT JOIN pillars pl ON pl.id = s.pillar_id
     WHERE p.status = 'posted'
  ORDER BY p.scheduled_at DESC
  `).all() as Row[];
}

function cut(list: Row[], keyOf: (r: Row) => string | null, labelOf: (k: string) => string): Cut[] {
  const groups = new Map<string, Row[]>();
  for (const r of list) {
    const k = keyOf(r);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const out: Cut[] = [];
  for (const [k, rs] of groups) {
    const eng = Math.round(rs.reduce((a, r) => a + engagementOf(r), 0) / rs.length);
    const reachVals = rs.map((r) => r.reach).filter((v): v is number => typeof v === "number");
    const top = [...rs].sort((a, b) => engagementOf(b) - engagementOf(a))[0];
    out.push({
      key: k,
      label: labelOf(k),
      posts: rs.length,
      engagement: eng,
      reach: reachVals.length ? Math.round(reachVals.reduce((a, b) => a + b, 0) / reachVals.length) : null,
      best: top?.topic || "",
      enough: rs.length >= MIN_ROWS,
    });
  }
  return out.sort((a, b) => b.engagement - a.engagement);
}

/* Everything BNC has posted on Instagram, whether or not it was planned in Circuit. This is the
   deeper pool: 30 posts of real history beats 1 post that happened to be managed here. Pillars
   can't be read off Instagram, but format, day and the posts that beat their own average can. */
const IG_FORMAT: Record<string, string> = { IMAGE: "Static post", CAROUSEL_ALBUM: "Carousel", REEL: "Reel", VIDEO: "Video" };
type OwnRow = { permalink: string; type: string; caption: string; posted_at: string; likes: number; comments: number; reach: number | null; saved: number | null; shares: number | null; file_id: string | null; verdict: string | null };

function ownRows(): OwnRow[] {
  return getDb().prepare("SELECT permalink, type, caption, posted_at, likes, comments, reach, saved, shares, file_id, verdict FROM own_posts WHERE posted_at <> ''").all() as OwnRow[];
}
const ownEngagement = (r: OwnRow) => r.likes + r.comments + (r.saved || 0) + (r.shares || 0);

function ownCut(list: OwnRow[], keyOf: (r: OwnRow) => string | null, labelOf: (k: string) => string): Cut[] {
  const groups = new Map<string, OwnRow[]>();
  for (const r of list) {
    const k = keyOf(r);
    if (k) groups.set(k, [...(groups.get(k) || []), r]);
  }
  return Array.from(groups).map(([k, rs]) => {
    const reachVals = rs.map((r) => r.reach).filter((v): v is number => typeof v === "number");
    const top = [...rs].sort((a, b) => ownEngagement(b) - ownEngagement(a))[0];
    return {
      key: k, label: labelOf(k), posts: rs.length,
      engagement: Math.round(rs.reduce((a, r) => a + ownEngagement(r), 0) / rs.length),
      reach: reachVals.length ? Math.round(reachVals.reduce((a, b) => a + b, 0) / reachVals.length) : null,
      best: (top?.caption || "").slice(0, 70),
      enough: rs.length >= MIN_ROWS,
    };
  }).sort((a, b) => b.engagement - a.engagement);
}

export function learned(): Learned {
  const list = rows();
  const dated = list.map((r) => r.scheduled_at).filter(Boolean).sort();
  const pillars = cut(list, (r) => r.pillar, (k) => k);
  const formats = cut(list, (r) => r.format, (k) => FORMAT_LABEL[k] || k);
  const platforms = cut(list, (r) => r.platform, (k) => k);
  const weekdays = cut(list, (r) => (r.scheduled_at ? DAYS[new Date(r.scheduled_at).getDay()] : null), (k) => k);

  // our own Instagram history, which is usually the larger pool
  const own = ownRows();
  const ownAverage = own.length ? Math.round(own.reduce((a, r) => a + ownEngagement(r), 0) / own.length) : 0;
  const ownFormats = ownCut(own, (r) => r.type, (k) => IG_FORMAT[k] || k);
  const ownWeekdays = ownCut(own, (r) => (r.posted_at ? DAYS[new Date(r.posted_at).getDay()] : null), (k) => k);
  const ownStandouts: Standout[] = own
    .filter((r) => ownAverage && ownEngagement(r) >= ownAverage * 2)
    .map((r) => ({ permalink: r.permalink, type: IG_FORMAT[r.type] || r.type, caption: (r.caption || "").slice(0, 120), posted_at: r.posted_at, engagement: ownEngagement(r), reach: r.reach, times: Math.round((ownEngagement(r) / ownAverage) * 10) / 10 }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 6);

  const solid = [...pillars, ...formats, ...platforms, ...weekdays].filter((c) => c.enough);
  const advice: string[] = [];
  const ownTopFormat = ownFormats.find((c) => c.enough);
  const ownWorstFormat = [...ownFormats].reverse().find((c) => c.enough && ownTopFormat && c.key !== ownTopFormat.key);
  if (ownTopFormat && ownWorstFormat && ownTopFormat.engagement > ownWorstFormat.engagement * 1.3) {
    advice.push(`${ownTopFormat.label}s earn ${Math.round((ownTopFormat.engagement / ownWorstFormat.engagement) * 10) / 10}× what ${ownWorstFormat.label.toLowerCase()}s do on your own account (${ownTopFormat.engagement} interactions a post across ${ownTopFormat.posts}).`);
  }
  const ownTopDay = ownWeekdays.find((c) => c.enough);
  if (ownTopDay) advice.push(`${ownTopDay.label} is your strongest posting day so far (${ownTopDay.posts} posts).`);
  if (ownStandouts[0]) advice.push(`Your biggest post did ${ownStandouts[0].times}× your average: "${ownStandouts[0].caption.slice(0, 60)}…" Worth making more like it.`);
  const topPillar = pillars.find((c) => c.enough);
  const topFormat = formats.find((c) => c.enough);
  const topDay = weekdays.find((c) => c.enough);
  if (topPillar) advice.push(`${topPillar.label} earns the most for you — ${topPillar.engagement.toLocaleString("en-IN")} interactions a post across ${topPillar.posts}.`);
  if (topFormat) advice.push(`${topFormat.label} outperforms your other formats (${topFormat.engagement.toLocaleString("en-IN")} a post).`);
  if (topDay) advice.push(`${topDay.label} is your strongest day so far.`);
  const weakest = [...pillars].reverse().find((c) => c.enough && topPillar && c.key !== topPillar.key);
  if (weakest && topPillar && weakest.engagement * 2 < topPillar.engagement) advice.push(`${weakest.label} does less than half of ${topPillar.label}. Worth fewer slots, or a different angle.`);

  const headline = own.length
    ? `Read straight from ${own.length} of your own Instagram posts${list.length ? `, plus ${list.length} planned here with numbers against them` : ""}. Pillar and platform patterns need posts planned in Circuit and marked posted with their link.`
    : !list.length
      ? "Nothing to learn from yet: no posted post has numbers against it."
      : solid.length
        ? `Based on ${list.length} posted post${list.length === 1 ? "" : "s"} with numbers.`
        : `${list.length} post${list.length === 1 ? " has" : "s have"} numbers. ${MIN_ROWS} in a group is the minimum before Circuit will call anything a pattern, so this is a picture, not advice yet.`;

  return {
    posts: list.length,
    with_numbers: list.length,
    from: dated[0] || "",
    to: dated[dated.length - 1] || "",
    pillars, formats, platforms, weekdays,
    own_posts: own.length, own_formats: ownFormats, own_weekdays: ownWeekdays, own_standouts: ownStandouts, own_average: ownAverage,
    headline,
    advice,
  };
}

/* What the planner should lean towards, only where the evidence is solid enough to say.
   Used by the calendar and the pillar editor; silent when it has nothing honest to offer. */
export function planHints(): { pillar: string; format: string; weekday: string; note: string } | null {
  const l = learned();
  const pillar = l.pillars.find((c) => c.enough);
  const format = l.formats.find((c) => c.enough);
  const weekday = l.weekdays.find((c) => c.enough);
  if (!pillar && !format && !weekday) return null;
  return {
    pillar: pillar?.label || "",
    format: format?.label || "",
    weekday: weekday?.label || "",
    note: `From your own results${l.from ? ` since ${l.from.slice(0, 10)}` : ""}.`,
  };
}

/* ---- the front page's version ---- */

/* The same Instagram history, cut down to what fits in a glance.

   learned() is the full picture and belongs on Analytics. This is the headline: how far the
   account reached, which post went furthest, and which format is actually earning its place.
   It reads the same rows, so the two can never disagree. */
export type TopPost = {
  permalink: string; type: string; caption: string; posted_at: string;
  reach: number | null; likes: number; comments: number; saved: number; file_id: string | null;
  /* How many times the average post's reach this one got. */
  times: number | null;
};

/* One month of the account's history. `thin` marks a month with too few posts for its average
   to mean much — two posts and a lucky one makes a spike that looks like a trend. The chart
   draws those differently rather than leaving them to be believed. */
export type IgMonth = {
  key: string; label: string; posts: number;
  avg_reach: number; best_reach: number; interactions: number; thin: boolean;
};

export type IgSummary = {
  posts: number;
  reach: number;
  average_reach: number | null;
  interactions: number;
  from: string; to: string;
  best: TopPost | null;
  /* Reel against carousel against still, by reach — the one comparison that changes what gets
     made next week. Only formats with enough posts behind them to mean anything. */
  formats: { label: string; posts: number; reach: number | null; engagement: number }[];
  /* Whether the recent half did better than the half before it. Null when there is too little
     history to halve honestly. */
  trend: { recent: number; earlier: number; change: number } | null;
  /* How stale this is. Instagram numbers are only as current as the last sync, and the account
     itself may simply not have posted — those are different problems and are named separately. */
  days_since_last_post: number | null;
  note: string;
  /* Month by month, oldest first — including months the account posted nothing, because a gap
     is the most informative thing a posting chart can show and leaving it out would draw a
     straight line through a silence. */
  months: IgMonth[];
  /* Every post as a point, for the dots behind the line. */
  points: { at: string; reach: number; type: string }[];
};

export function igSummary(): IgSummary {
  const own = ownRows();
  if (!own.length) {
    return {
      posts: 0, reach: 0, average_reach: null, interactions: 0, from: "", to: "",
      best: null, formats: [], trend: null, days_since_last_post: null,
      note: "No Instagram history yet. Connect Meta in Settings and Circuit reads what the account has already published.",
      months: [], points: [],
    };
  }

  const byDate = [...own].sort((a, b) => (a.posted_at || "").localeCompare(b.posted_at || ""));
  const reachOf = (r: OwnRow) => (typeof r.reach === "number" ? r.reach : null);
  const reached = own.map(reachOf).filter((v): v is number => v !== null);
  const totalReach = reached.reduce((a, b) => a + b, 0);
  const avgReach = reached.length ? Math.round(totalReach / reached.length) : null;
  const interactions = own.reduce((a, r) => a + ownEngagement(r), 0);

  /* "Most viewed" means reach where Instagram gave us reach. Falling back to likes when it did
     not would put two different measurements in the same ranking. */
  /* A post the owner set aside is still part of what the account did, so it stays in the
     totals above. It comes out of everything below, because those are advice: a post dropped
     from the learning should not be the one Circuit holds up as the model. */
  const counted = own.filter((r) => (r.verdict || "") !== "aside");
  const setAside = own.length - counted.length;

  const ranked = counted.filter((r) => reachOf(r) !== null).sort((a, b) => (b.reach || 0) - (a.reach || 0));
  const top = ranked[0] || null;
  const best: TopPost | null = top
    ? {
        permalink: top.permalink,
        type: IG_FORMAT[top.type] || top.type,
        caption: (top.caption || "").replace(/\s+/g, " ").trim().slice(0, 150),
        posted_at: top.posted_at,
        reach: top.reach,
        likes: top.likes || 0,
        comments: top.comments || 0,
        saved: top.saved || 0,
        file_id: top.file_id || null,
        times: avgReach && top.reach ? Math.round((top.reach / avgReach) * 10) / 10 : null,
      }
    : null;

  const formats = ownCut(counted, (r) => r.type, (k) => IG_FORMAT[k] || k)
    .filter((c) => c.enough)
    .map((c) => ({ label: c.label, posts: c.posts, reach: c.reach, engagement: c.engagement }))
    .sort((a, b) => (b.reach || 0) - (a.reach || 0));

  /* Halved by position in time, not by a fixed window: the account posts irregularly, and a
     "last 30 days" that contains two posts says less than nothing. */
  let trend: IgSummary["trend"] = null;
  const withReach = byDate.filter((r) => reachOf(r) !== null);
  if (withReach.length >= 6) {
    const half = Math.floor(withReach.length / 2);
    const mean = (rs: OwnRow[]) => Math.round(rs.reduce((a, r) => a + (r.reach || 0), 0) / rs.length);
    const earlier = mean(withReach.slice(0, half));
    const recent = mean(withReach.slice(half));
    trend = { recent, earlier, change: earlier ? Math.round(((recent - earlier) / earlier) * 100) : 0 };
  }

  const last = byDate[byDate.length - 1]?.posted_at || "";
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;

  /* Said rather than left to be worked out from a date. Nine months of silence is the most
     important thing on this panel, and it would otherwise be the least noticeable. */
  const asideNote = setAside ? ` ${setAside} post${setAside === 1 ? " is" : "s are"} set aside and left out of the comparisons below.` : "";
  const note = (days === null
    ? ""
    : days > 60
      ? `Nothing new on the account since ${new Date(last).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} — ${Math.round(days / 30)} months ago. These are real numbers about old posts.`
      : days > 14
        ? `Last post was ${days} days ago.`
        : "") + asideNote;

  /* Grouped by calendar month, then every month between the first and the last filled in —
     a month with nothing in it is drawn as a gap, not skipped. */
  const buckets = new Map<string, OwnRow[]>();
  for (const r of byDate) {
    const k = (r.posted_at || "").slice(0, 7);
    if (k) buckets.set(k, [...(buckets.get(k) || []), r]);
  }
  const months: IgMonth[] = [];
  const keys = [...buckets.keys()].sort();
  if (keys.length) {
    const [fy, fm] = keys[0].split("-").map(Number);
    const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
    const cur = new Date(Date.UTC(fy, fm - 1, 1));
    const end = new Date(Date.UTC(ly, lm - 1, 1));
    while (cur <= end) {
      const k = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`;
      const rs = buckets.get(k) || [];
      const reaches = rs.map((r) => r.reach).filter((v): v is number => typeof v === "number");
      months.push({
        key: k,
        label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
        posts: rs.length,
        avg_reach: reaches.length ? Math.round(reaches.reduce((a, b) => a + b, 0) / reaches.length) : 0,
        best_reach: reaches.length ? Math.max(...reaches) : 0,
        interactions: rs.reduce((a, r) => a + ownEngagement(r), 0),
        /* Three is the same floor the rest of this module uses before it calls anything a
           pattern. Below it, an average is one good post wearing a trend's clothes. */
        thin: rs.length > 0 && rs.length < MIN_ROWS,
      });
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const points = byDate
    .filter((r) => reachOf(r) !== null)
    .map((r) => ({ at: r.posted_at, reach: r.reach as number, type: IG_FORMAT[r.type] || r.type }));

  return {
    posts: own.length,
    reach: totalReach,
    average_reach: avgReach,
    interactions,
    from: byDate[0]?.posted_at || "",
    to: last,
    best, formats, trend,
    days_since_last_post: days,
    note,
    months, points,
  };
}
