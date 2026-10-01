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
    const done = tasks.filter((t) => t.status === "done" && t.end_date.slice(0, 7) === m).length;
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
    ahead,
    admin: adminSummary(),
    work: {
      total: tasks.length,
      doing: tasks.filter((t) => t.status === "doing").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      late: tasks.filter((t) => t.status !== "done" && t.end_date && t.end_date < today).length,
      done_this_month: tasks.filter((t) => t.status === "done" && t.end_date.slice(0, 7) === thisMonth()).length,
    },
  };
}
