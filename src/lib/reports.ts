import { getDb } from "@/lib/db";
import { listTasks, pnlRange, adminSummary, type PnlMonth } from "@/lib/books";
import { monthsBack, thisMonth, change } from "@/lib/money";

/* The one page that reads across the whole app.

   Everything here is already recorded somewhere else — posts, reach, bills, salaries, tasks.
   Reports adds nothing new; it only puts the month beside the month before it, because a number
   on its own says very little and the same number with last month's beside it says most of it. */

export type MonthRow = {
  month: string;
  posts: number; posted: number; reach: number; likes: number; comments: number; engagement: number;
  briefings: number;
  tasks_done: number; tasks_open: number;
  bills: number; bills_value: number;
  pnl: PnlMonth;
};

export function monthly(n = 12): MonthRow[] {
  const db = getDb();
  const months = monthsBack(n);
  const from = `${months[0]}-01`;
  const pnl = new Map(pnlRange(months).map((p) => [p.month, p]));

  /* Everything scheduled, and everything that actually went out. */
  const slots = db.prepare("SELECT substr(date,1,7) m, COUNT(*) n FROM slots WHERE date >= ? GROUP BY m").all(from) as { m: string; n: number }[];
  const posted = db.prepare("SELECT substr(scheduled_at,1,7) m, COUNT(*) n FROM posts WHERE status = 'posted' AND scheduled_at >= ? GROUP BY m").all(from) as { m: string; n: number }[];

  /* The numbers those posts came back with. One metrics row per post is the latest reading. */
  const reach = db.prepare(`
    SELECT substr(p.scheduled_at,1,7) m,
           SUM(COALESCE(mt.reach, 0)) reach, SUM(COALESCE(mt.likes, 0)) likes, SUM(COALESCE(mt.comments, 0)) comments
    FROM posts p JOIN metrics mt ON mt.post_id = p.id
    WHERE p.scheduled_at >= ? GROUP BY m`).all(from) as { m: string; reach: number; likes: number; comments: number }[];

  const briefs = db.prepare("SELECT substr(date,1,7) m, COUNT(*) n FROM intel_pdfs WHERE date >= ? GROUP BY m").all(months[0]) as { m: string; n: number }[];
  const bills = db.prepare("SELECT substr(bill_date,1,7) m, COUNT(*) n, SUM(amount + tax) v FROM bills WHERE bill_date >= ? GROUP BY m").all(from) as { m: string; n: number; v: number }[];

  const tasks = listTasks();
  const pick = <T extends { m: string }>(rows: T[], m: string) => rows.find((r) => r.m === m);

  return months.map((m) => {
    const r = pick(reach, m);
    const likes = r?.likes || 0;
    const comments = r?.comments || 0;
    const reached = r?.reach || 0;
    /* Closed in this month, not due in it — the same rule as the work report. */
    const done = tasks.filter((t) => t.status === "done" && (t.updated_at || t.end_date || "").slice(0, 7) === m).length;
    /* Open means it overlaps the month and is not finished — a task started in June and still
       running in September is open in September, not only in June. */
    const open = tasks.filter((t) => t.status !== "done" && t.start_date.slice(0, 7) <= m && (t.end_date.slice(0, 7) >= m)).length;
    const b = pick(bills, m);
    return {
      month: m,
      posts: pick(slots, m)?.n || 0,
      posted: pick(posted, m)?.n || 0,
      reach: reached, likes, comments,
      engagement: reached ? Math.round(((likes + comments) / reached) * 1000) / 10 : 0,
      briefings: pick(briefs, m)?.n || 0,
      tasks_done: done, tasks_open: open,
      bills: b?.n || 0, bills_value: b?.v || 0,
      pnl: pnl.get(m) as PnlMonth,
    };
  });
}

export type Headline = { key: string; label: string; value: number; kind: "money" | "number" | "percent"; delta: number | null; hint: string };

/* This month against last, for the strip across the top. */
export function headlines(rows: MonthRow[]): Headline[] {
  const cur = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!cur) return [];
  const p = prev || cur;
  const one = (key: string, label: string, value: number, before: number, kind: Headline["kind"], hint: string): Headline =>
    ({ key, label, value, kind, delta: prev ? change(value, before) : null, hint });

  return [
    one("revenue", "Revenue", cur.pnl.revenue, p.pnl.revenue, "money", "What you typed into the P&L for this month"),
    one("costs", "Running cost", cur.pnl.costs, p.pnl.costs, "money", "Manpower plus opex that are live this month"),
    one("net", "Net", cur.pnl.net, p.pnl.net, "money", "Revenue less cost of sales, manpower and opex"),
    one("posted", "Posts out", cur.posted, p.posted, "number", "Posts marked as posted this month"),
    one("reach", "Reach", cur.reach, p.reach, "number", "Added up from the numbers Instagram gave back"),
    one("engagement", "Engagement", cur.engagement, p.engagement, "percent", "Likes and comments against reach"),
  ];
}

export function dashboard(n = 12) {
  const db = getDb();
  const rows = monthly(n);
  const tasks = listTasks();
  const today = new Date().toISOString().slice(0, 10);
  /* Reports look backwards — you cannot report a result that has not happened. But the calendar
     looks forwards, and a dashboard that shows nothing because all the work is next month reads
     as broken rather than as early. So what is booked ahead is counted separately, and named
     as such. */
  const ahead = db.prepare("SELECT COUNT(*) n, MIN(date) first, MAX(date) last FROM slots WHERE date > ?").get(today) as { n: number; first: string | null; last: string | null };
  return {
    months: rows,
    headlines: headlines(rows),
    /* The two reports people actually ask for: what went out, and what got done. */
    social: socialReport(),
    worked: workReport(),
    ahead,
    admin: adminSummary(),
    work: {
      total: tasks.length,
      doing: tasks.filter((t) => t.status === "doing").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      late: tasks.filter((t) => t.status !== "done" && t.end_date && t.end_date < today).length,
      /* The same rule the work report uses, so the two cannot disagree on one page. They did:
         this counted a finished task in the month it was due, the report counted it in the
         month it was closed, and the summary said none finished while the report said five. */
      done_this_month: tasks.filter((t) => t.status === "done" && (t.updated_at || t.end_date || "").slice(0, 7) === thisMonth()).length,
    },
  };
}

/* ---- the social media report ---- */

/* What actually went out on Instagram, month by month.

   Separate from `monthly()` above, which counts what was planned in Circuit and what Circuit
   marked as posted. Those are two different questions and mixing them produces a report that is
   wrong in both directions: the account has been publishing since May 2025, long before any of
   it was planned here, and a post planned here is not evidence that it went out.

   This half reads the account's own history, which is the larger and more honest pool. */

export type SocialMonth = {
  month: string; label: string;
  posts: number;
  reels: number; carousels: number; stills: number;
  reach: number; avg_reach: number;
  likes: number; comments: number; saved: number; shares: number;
  interactions: number;
  /* Interactions against reach, as a percentage to one decimal. Null when reach is unknown,
     rather than zero — a month with no reach figure did not get no engagement. */
  engagement: number | null;
  best_reach: number;
  thin: boolean;
};

export type SocialReport = {
  months: SocialMonth[];
  totals: { posts: number; reach: number; interactions: number; months: number };
  by_format: { label: string; posts: number; avg_reach: number; avg_interactions: number }[];
  busiest: SocialMonth | null;
  quietest: SocialMonth | null;
  from: string; to: string;
  notes: string[];
};

const IG_LABEL: Record<string, string> = { IMAGE: "Still", CAROUSEL_ALBUM: "Carousel", REEL: "Reel", VIDEO: "Video" };

export function socialReport(): SocialReport {
  const rows = getDb().prepare(`
    SELECT posted_at, type, COALESCE(likes,0) likes, COALESCE(comments,0) comments,
           COALESCE(saved,0) saved, COALESCE(shares,0) shares, reach, COALESCE(verdict,'') verdict
    FROM own_posts WHERE posted_at <> '' ORDER BY posted_at`)
    .all() as { posted_at: string; type: string; likes: number; comments: number; saved: number; shares: number; reach: number | null; verdict: string }[];

  if (!rows.length) {
    return {
      months: [], totals: { posts: 0, reach: 0, interactions: 0, months: 0 },
      by_format: [], busiest: null, quietest: null, from: "", to: "",
      notes: ["No Instagram history yet. Connect Meta in Settings and Circuit reads what the account has already published."],
    };
  }

  const buckets = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.posted_at.slice(0, 7);
    buckets.set(k, [...(buckets.get(k) || []), r]);
  }

  /* Every month between the first post and the last, including the empty ones. A report that
     silently skips a month the account said nothing in is a report that hides the gap. */
  const keys = [...buckets.keys()].sort();
  const [fy, fm] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  const months: SocialMonth[] = [];
  const cur = new Date(Date.UTC(fy, fm - 1, 1));
  const end = new Date(Date.UTC(ly, lm - 1, 1));

  while (cur <= end) {
    const k = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`;
    const rs = buckets.get(k) || [];
    const reached = rs.map((r) => r.reach).filter((v): v is number => typeof v === "number");
    const reach = reached.reduce((a, b) => a + b, 0);
    const likes = rs.reduce((a, r) => a + r.likes, 0);
    const comments = rs.reduce((a, r) => a + r.comments, 0);
    const saved = rs.reduce((a, r) => a + r.saved, 0);
    const shares = rs.reduce((a, r) => a + r.shares, 0);
    const interactions = likes + comments + saved + shares;
    months.push({
      month: k,
      label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      posts: rs.length,
      reels: rs.filter((r) => r.type === "REEL").length,
      carousels: rs.filter((r) => r.type === "CAROUSEL_ALBUM").length,
      stills: rs.filter((r) => r.type === "IMAGE").length,
      reach,
      avg_reach: reached.length ? Math.round(reach / reached.length) : 0,
      likes, comments, saved, shares, interactions,
      engagement: reach ? Math.round((interactions / reach) * 1000) / 10 : null,
      best_reach: reached.length ? Math.max(...reached) : 0,
      thin: rs.length > 0 && rs.length < 3,
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  /* Set-aside posts stay in the counts — they are part of what the account did — and come out
     of the format comparison, which is advice. */
  const counted = rows.filter((r) => r.verdict !== "aside");
  const formats = new Map<string, typeof rows>();
  for (const r of counted) formats.set(r.type, [...(formats.get(r.type) || []), r]);
  const by_format = [...formats.entries()]
    .map(([t, rs]) => {
      const reached = rs.map((r) => r.reach).filter((v): v is number => typeof v === "number");
      return {
        label: IG_LABEL[t] || t,
        posts: rs.length,
        avg_reach: reached.length ? Math.round(reached.reduce((a, b) => a + b, 0) / reached.length) : 0,
        avg_interactions: Math.round(rs.reduce((a, r) => a + r.likes + r.comments + r.saved + r.shares, 0) / rs.length),
      };
    })
    .filter((f) => f.posts >= 3)
    .sort((a, b) => b.avg_reach - a.avg_reach);

  const withPosts = months.filter((m) => m.posts > 0);
  const busiest = [...withPosts].sort((a, b) => b.posts - a.posts)[0] || null;
  const quietest = [...withPosts].sort((a, b) => a.posts - b.posts)[0] || null;

  const notes: string[] = [];
  const empty = months.filter((m) => m.posts === 0).length;
  if (empty) notes.push(`${empty} month${empty === 1 ? "" : "s"} in this range had nothing posted at all. They are shown as zero rather than left out.`);
  const last = rows[rows.length - 1].posted_at;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  if (days > 60) notes.push(`Nothing new since ${new Date(last).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} — ${Math.round(days / 30)} months ago. This is a report about old posts.`);
  if (months.some((m) => m.thin)) notes.push("A month marked thin had fewer than three posts. Its averages are one post wearing a trend's clothes.");

  return {
    months,
    totals: {
      posts: rows.length,
      reach: months.reduce((a, m) => a + m.reach, 0),
      interactions: months.reduce((a, m) => a + m.interactions, 0),
      months: withPosts.length,
    },
    by_format, busiest, quietest,
    from: rows[0].posted_at.slice(0, 10), to: last.slice(0, 10),
    notes,
  };
}

/* ---- what the team got done ---- */

/* The work report. Finished work by month, and where the hours went.

   Counted on the day the row last changed, not on the day the work was due to end.

   The due date was the obvious choice and it was wrong twice over: work finished early or late
   lands in the month it was planned for rather than the month it happened, and a task due next
   December falls outside a report of the last twelve months altogether — so five finished jobs
   showed as five in the total and nothing at all in the monthly column, which is a report
   contradicting itself on the same screen.

   `updated_at` is not a completion timestamp either; it is when the record last changed, which
   for a task that is done is when somebody marked it done, unless they edited it afterwards.
   That is the closest thing the board holds, and the page says as much rather than implying a
   precision that is not there. */
export type WorkMonth = { month: string; label: string; done: number; minutes: number; areas: string };

export type WorkReport = {
  months: WorkMonth[];
  by_area: { area: string; done: number; open: number; late: number; minutes: number }[];
  open: number; late: number; unowned: number;
  /* Of the work that carries a judgement, how much could be handed to Circuit. */
  could_automate_minutes: number; judged_minutes: number;
  notes: string[];
};

export function workReport(n = 12): WorkReport {
  const tasks = listTasks();
  const months = monthsBack(n);
  const today = new Date().toISOString().slice(0, 10);

  const monthRows: WorkMonth[] = months.map((m) => {
    const done = tasks.filter((t) => t.status === "done" && (t.updated_at || t.end_date || "").slice(0, 7) === m);
    const areas = [...new Set(done.map((t) => t.title.includes(" — ") ? t.title.split(" — ")[0] : t.area))];
    return {
      month: m,
      label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      done: done.length,
      minutes: done.reduce((a, t) => a + (t.spent_minutes || t.estimate_minutes || 0), 0),
      areas: areas.slice(0, 3).join(", "),
    };
  });

  /* Grouped by the discipline in the title where there is one, because "marketing" as an area
     covers every row on this board and tells nobody anything. */
  const groupOf = (t: { title: string; area: string }) => (t.title.includes(" — ") ? t.title.split(" — ")[0] : t.area || "other");
  const groups = new Map<string, typeof tasks>();
  for (const t of tasks) groups.set(groupOf(t), [...(groups.get(groupOf(t)) || []), t]);

  const by_area = [...groups.entries()].map(([area, ts]) => ({
    area,
    done: ts.filter((t) => t.status === "done").length,
    open: ts.filter((t) => t.status !== "done").length,
    late: ts.filter((t) => t.status !== "done" && t.end_date && t.end_date < today).length,
    minutes: ts.reduce((a, t) => a + (t.spent_minutes || t.estimate_minutes || 0), 0),
  })).sort((a, b) => b.open + b.done - (a.open + a.done));

  const judged = tasks.filter((t) => t.doable_by);
  const judgedMinutes = judged.reduce((a, t) => a + (t.spent_minutes || t.estimate_minutes || 0), 0);
  const autoMinutes = judged.filter((t) => t.doable_by === "app").reduce((a, t) => a + (t.spent_minutes || t.estimate_minutes || 0), 0);

  const notes: string[] = [];
  if (!tasks.some((t) => t.status === "done")) notes.push("Nothing on the board is marked done yet, so the monthly column is empty. It fills as work is closed off.");
  const doneTotal = tasks.filter((t) => t.status === "done").length;
  const inWindow = monthRows.reduce((a, m) => a + m.done, 0);
  if (doneTotal > inWindow) notes.push(`${doneTotal - inWindow} finished ${doneTotal - inWindow === 1 ? "task falls" : "tasks fall"} outside the last ${n} months and are counted in the totals but not in the monthly column.`);
  notes.push("Finished work is counted in the month its record last changed, which for a finished task is normally when it was closed off. The board keeps no completion date of its own.");
  const unowned = tasks.filter((t) => !t.owner?.trim()).length;
  if (unowned) notes.push(`${unowned} of ${tasks.length} have nobody's name on them.`);

  return {
    months: monthRows,
    by_area,
    open: tasks.filter((t) => t.status !== "done").length,
    late: tasks.filter((t) => t.status !== "done" && t.end_date && t.end_date < today).length,
    unowned,
    could_automate_minutes: autoMinutes,
    judged_minutes: judgedMinutes,
    notes,
  };
}
