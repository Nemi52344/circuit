import { handleUser, ok } from "@/lib/http";
import { can } from "@/lib/roles";
import { getDb } from "@/lib/db";
import { listTasks, pnlMonth } from "@/lib/books";
import { thisMonth } from "@/lib/money";
import { lastIntel } from "@/lib/intel";
import { igSummary } from "@/lib/learn";
import { waitingForSignoff } from "@/lib/signoff";
import { engageStats } from "@/lib/joinin";
import { people } from "@/lib/inbox";
import { slotVerdict } from "@/lib/contentstatus";

export const runtime = "nodejs";

/* The few numbers the front page stands on.

   Deliberately small. A landing page that runs the whole dashboard underneath it
   is slow for no reason, and the point of this one is to say what state the place
   is in — how much is moving, how much is waiting on you — not to replace
   Reports. Everything here is counted, never estimated. */
export const GET = handleUser(async (_req, user) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const tasks = listTasks();

  const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

  return ok({
    planned: one("SELECT COUNT(*) n FROM slots WHERE status != 'posted'"),
    ahead: one("SELECT COUNT(*) n FROM slots WHERE date > ?", today),
    posted: one("SELECT COUNT(*) n FROM posts WHERE status = 'posted'"),
    assets: one("SELECT COUNT(*) n FROM files"),
    known: one("SELECT COUNT(*) n FROM knowledge"),
    briefings: one("SELECT COUNT(*) n FROM intel_pdfs"),
    competitors: one("SELECT COUNT(*) n FROM inspirations"),
    work: {
      open: tasks.filter((t) => t.status !== "done").length,
      doing: tasks.filter((t) => t.status === "doing").length,
      late: tasks.filter((t) => t.status !== "done" && t.end_date && t.end_date < today).length,
    },
    /* Net for the month is salaries and opex underneath, so it shows only to the Admin.
       Everyone else gets nothing rather than a zero, which would read as "we made nothing". */
    month: can(user, "finance") ? pnlMonth(thisMonth()) : null,
    /* How the account is actually doing, read from its own Instagram history. */
    ig: igSummary(),
    last_intel: lastIntel(),
    today: todayFor(user?.id || "", can(user, "manage"), today, tasks),
  });
});

/* What needs this person today, for the top of Home: their work that is due or late (everyone's
   for whoever runs the team), the posters waiting for sign-off, the next seven days of the
   calendar, and the day's comments against the Engager's goal. */
function todayFor(me: string, manager: boolean, today: string, tasks: ReturnType<typeof listTasks>) {
  const db = getDb();
  const week = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.status !== "done" && (manager || t.assignee_id === me));
  const due = open
    .filter((t) => t.end_date && t.end_date <= today)
    .sort((a, b) => (a.end_date || "").localeCompare(b.end_date || "") || (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0));
  /* Names from the team list, which covers people with a login and without one alike. */
  const names = new Map(people().map((p) => [p.id, p.name]));
  const waiting = waitingForSignoff();
  const slots = db.prepare("SELECT id, date, topic, platforms, stage, status FROM slots WHERE date >= ? AND date <= ? ORDER BY date, time LIMIT 6")
    .all(today, week) as { id: string; date: string; topic: string; platforms: string; stage: number; status: string }[];
  const plats = (raw: string) => { try { return (JSON.parse(raw || "[]") as string[]).slice(0, 3); } catch { return []; } };
  return {
    mine: !manager,
    due: due.slice(0, 5).map((t) => ({
      id: t.id, title: t.title, end_date: t.end_date, late: t.end_date < today, priority: t.priority || "",
      who: t.assignee_id ? (names.get(t.assignee_id) || t.assignee_id.replace(/^member:/, "")) : "",
    })),
    due_total: due.length,
    open_total: open.length,
    signoff: waiting.slice(0, 5).map((p) => ({
      id: p.id, platform: p.platform, caption: (p.caption || "").slice(0, 90), when: p.scheduled_at,
      late: p.scheduled_at.slice(0, 10) < today, back: p.signoff?.decision === "rejected",
    })),
    signoff_total: waiting.length,
    week: slots.map((x) => ({ id: x.id, date: x.date, topic: x.topic, platforms: plats(x.platforms), stage: slotVerdict({ stage: x.stage, status: x.status }).line })),
    engage: (() => { const e = engageStats(); return { today: e.today, goal: e.goal, streak: e.streak }; })(),
  };
}
