import { handle, ok } from "@/lib/http";
import { getDb } from "@/lib/db";
import { listTasks, pnlMonth } from "@/lib/books";
import { thisMonth } from "@/lib/money";
import { lastIntel } from "@/lib/intel";

export const runtime = "nodejs";

/* The few numbers the front page stands on.

   Deliberately small. A landing page that runs the whole dashboard underneath it
   is slow for no reason, and the point of this one is to say what state the place
   is in — how much is moving, how much is waiting on you — not to replace
   Reports. Everything here is counted, never estimated. */
export const GET = handle(async () => {
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
    month: pnlMonth(thisMonth()),
    last_intel: lastIntel(),
  });
});
