import { handleUser, ok } from "@/lib/http";
import { can } from "@/lib/roles";
import { dashboard } from "@/lib/reports";
import { getDb } from "@/lib/db";
import { listTasks } from "@/lib/books";
import { people } from "@/lib/inbox";
import { waitingForSignoff } from "@/lib/signoff";
import { thisMonth } from "@/lib/money";

export const runtime = "nodejs";

const NO_MONEY = { revenue: 0, costs: 0, net: 0 };

/* Who is carrying what: open, late and finished this month, per person who takes work, plus
   whatever is open with nobody's name on it. */
function team() {
  const tasks = listTasks();
  const today = new Date().toISOString().slice(0, 10);
  const month = thisMonth();
  const row = (id: string, name: string) => {
    const mine = tasks.filter((t) => (t.assignee_id || "") === id);
    return {
      id, name,
      open: mine.filter((t) => t.status !== "done").length,
      late: mine.filter((t) => t.status !== "done" && t.end_date && t.end_date < today).length,
      done_month: mine.filter((t) => t.status === "done" && (t.updated_at || t.end_date || "").slice(0, 7) === month).length,
      done_all: mine.filter((t) => t.status === "done").length,
    };
  };
  const rows = people().filter((p) => p.takes_work).map((p) => row(p.id, p.name));
  const nobody = row("", "Nobody yet");
  return nobody.open ? [...rows, nobody] : rows;
}

/* What the Library holds that is ours to use. */
function library() {
  const db = getDb();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    photos: n("SELECT COUNT(*) n FROM files WHERE kind IN ('raw', 'product') AND mime LIKE 'image/%'"),
    product: n("SELECT COUNT(*) n FROM files WHERE kind = 'product'"),
    videos: n("SELECT COUNT(*) n FROM files WHERE kind = 'raw' AND mime LIKE 'video/%'"),
    brochures: n("SELECT COUNT(*) n FROM documents WHERE kind IN ('brochure', 'flyer', 'spec sheet')"),
    inspiration: n("SELECT COUNT(*) n FROM files WHERE kind = 'inspiration'"),
    made: n("SELECT COUNT(*) n FROM files WHERE kind = 'generated'"),
  };
}

export const GET = handleUser(async (req, user) => {
  const n = Number(new URL(req.url).searchParams.get("months") || 12);
  const d = dashboard(Math.min(Math.max(n, 3), 24));

  /* The same report for everyone, with the money taken out for those who may not see it.

     Removed here, on the server, rather than hidden on the page: a figure blanked by the page
     still arrives in the response, and anyone can read a response. Revenue, running cost and
     net come from salaries and opex, so they go with the Finance permission; unpaid bills and
     stock value go with the one that runs the spend. */
  const money = can(user, "finance");
  const spend = can(user, "manage");
  return ok({
    ...d,
    months: money ? d.months : d.months.map((m) => ({ ...m, pnl: { ...m.pnl, ...NO_MONEY } })),
    headlines: money ? d.headlines : d.headlines.filter((h) => h.kind !== "money"),
    admin: spend ? d.admin : null,
    can_see_money: money,
    team: team(),
    signoff: waitingForSignoff().length,
    library: library(),
  });
});
