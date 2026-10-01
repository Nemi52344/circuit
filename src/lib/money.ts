/* Money, kept in paise.

   Every amount in the database is a whole number of paise. Rupees as decimals would drift: add
   a hundred invoices of ₹333.33 in floating point and the total is wrong by the time anyone
   notices. Integers cannot drift, so the only rounding happens once, on the way in. */

export const toPaise = (rupees: string | number): number => {
  const n = typeof rupees === "number" ? rupees : Number(String(rupees).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const toRupees = (paise: number): number => (paise || 0) / 100;

/* Indian grouping — ₹1,23,456 and not ₹123,456, because that is how the numbers get read out. */
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (paise: number) => inr.format(toRupees(paise));
export const moneyExact = (paise: number) => inr2.format(toRupees(paise));

/* Big figures on a dashboard read better short. ₹12.4L, ₹3.2Cr — the units people actually use. */
export function moneyShort(paise: number): string {
  const r = Math.abs(toRupees(paise));
  const sign = paise < 0 ? "-" : "";
  /* One decimal is the difference between "₹16L" and "₹15.7L", and on a headline figure that
     difference is three hundred thousand rupees. Keep it until the unit itself makes it noise. */
  if (r >= 1e7) return `${sign}₹${(r / 1e7).toFixed(r >= 1e9 ? 0 : 2)}Cr`;
  if (r >= 1e5) return `${sign}₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1000) return `${sign}₹${(r / 1000).toFixed(r >= 1e5 ? 0 : 1)}k`;
  return `${sign}₹${Math.round(r)}`;
}

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "2026-09" → "Sep 2026". */
export const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  const i = Number(mm) - 1;
  return MONTH_NAMES[i] ? `${MONTH_NAMES[i]} ${y}` : m;
};

export const thisMonth = () => new Date().toISOString().slice(0, 7);

/* The last n months ending at `end`, oldest first — the spine of every month-on-month table. */
export function monthsBack(n: number, end = thisMonth()): string[] {
  const [y, m] = end.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/* Was this line running in that month? An empty date means "always", which is what an ongoing
   cost or a person with no leaving date actually means. */
export const activeIn = (month: string, from: string, to: string) =>
  (!from || from.slice(0, 7) <= month) && (!to || to.slice(0, 7) >= month);

/* A change from one month to the next, as a percentage. Null when there is nothing to compare
   against — a made-up 100% on a first month is worse than an honest blank. */
export const change = (now: number, before: number): number | null =>
  before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
