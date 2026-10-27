/* What is on the shelf today, worked out rather than counted.

   A stock list is only right on the day it is counted. Given how many of each thing get used in
   a month, Circuit can say what is probably left now, when it runs out, and the day to reorder
   so it never does — without anybody counting again until the next real count resets it.
   No imports, so the Admin page and the tests read the same arithmetic. */

export type Outlook = { left: number; runs_out: string | null; reorder_by: string | null; low: boolean; stale: boolean };

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function stockOutlook(
  it: { qty: number; reorder_at: number; per_month?: number; counted_at: string },
  today: string = new Date().toISOString().slice(0, 10),
): Outlook {
  const perDay = Math.max(0, it.per_month || 0) / 30.4;
  const from = Date.parse(`${it.counted_at || today}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const days = Math.max(0, (now - from) / DAY);
  const left = Math.max(0, Math.round((it.qty - perDay * days) * 10) / 10);
  const runs_out = perDay > 0 ? iso(from + (it.qty / perDay) * DAY) : null;
  const reorder_by = perDay > 0 && it.reorder_at > 0 ? iso(from + (Math.max(0, it.qty - it.reorder_at) / perDay) * DAY) : null;
  return {
    left, runs_out, reorder_by,
    low: it.reorder_at > 0 && left <= it.reorder_at,
    /* A count more than a month old is an estimate leaning on an estimate. */
    stale: !it.counted_at || days > 31,
  };
}
