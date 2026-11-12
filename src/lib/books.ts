import { getDb, newId, now } from "@/lib/db";
import { stockOutlook } from "@/lib/stockmath";
import { activeIn, monthsBack, thisMonth } from "@/lib/money";

/* The books: what the company owes, holds, pays and earns.

   Circuit is not an accounting system and should not act like one. It holds the handful of
   numbers a marketing lead actually needs in front of them — the bills sitting unpaid, what is
   on the shelf, what the month costs to run — and it never invents any of them.

   The one piece of arithmetic it does do is the month's costs: manpower and opex are standing
   lines with a start and an end, so a month's figure is the sum of whatever was running that
   month. Typing the same salary into twelve months by hand is how spreadsheets go wrong. */

export type Task = {
  id: string; title: string; notes: string; owner: string; area: string;
  start_date: string; end_date: string; status: string; progress: number;
  depends_on: string | null; created_at: string; updated_at: string;
  /* How long this was expected to take, and how long it did. Both in minutes, both optional:
     a board that refuses work without an estimate is a board people stop using, and a task
     written before these existed has neither. */
  estimate_minutes?: number; spent_minutes?: number;
  /* What Circuit can do about this piece of work — see lib/doors.ts. */
  door?: string;
  /* Whether a person has to do this or the app could. Blank until somebody says — guessing
     would turn the automation figure into a fiction. */
  doable_by?: string;
  /* Who has it, as an account, and what kind of work it is — set by the work inbox
     (lib/inbox.ts) or by a manager moving it. `owner` keeps the name for the Gantt. */
  assignee_id?: string; kind?: string; request_id?: string; assign_reason?: string; priority?: string;
};

/* Who could do a piece of work. "person" means it needs judgement, a relationship or a pair
   of hands; "app" means Circuit could take it over and has not yet. */
export const DOABLE_BY = ["", "person", "app"] as const;
export type Bill = {
  id: string; vendor: string; number: string; bill_date: string; due_date: string;
  amount: number; tax: number; category: string; status: string; file_id: string | null;
  notes: string; created_at: string; updated_at: string;
};
export type StockItem = {
  id: string; item: string; sku: string; category: string; qty: number; unit: string;
  location: string; reorder_at: number; unit_cost: number; counted_at: string; notes: string;
  per_month: number; created_at: string; updated_at: string;
};
export type Person = {
  id: string; name: string; role: string; department: string; monthly_cost: number;
  started_on: string; ended_on: string; kind: string; notes: string; created_at: string; updated_at: string;
};
export type Opex = {
  id: string; item: string; category: string; vendor: string; monthly_cost: number;
  starts_on: string; ends_on: string; notes: string; created_at: string; updated_at: string;
};
export type Subscription = {
  id: string; tool: string; plan: string; monthly_cost: number; billing_day: number; card_name: string;
  used_for: string; status: string; starts_on: string; ends_on: string; notes: string; created_at: string; updated_at: string;
  /* As the team's sheet keeps it: who it is for, the price in the currency charged (in its
     cents) and in rupees (paise) per renewal, how often it renews, what kind of charge, whose
     card, and when it was last paid. monthly_cost is worked out from period_cost and cycle. */
  owner: string; currency: string; foreign_cost: number; period_cost: number; cycle: string; kind: string; card_holder: string; last_paid: string;
};
export type PnlRow = { month: string; revenue: number; cogs: number; other_in: number; other_out: number; notes: string; updated_at: string };

export const TASK_STATUS = ["planned", "doing", "blocked", "done"] as const;
export const TASK_AREAS = ["marketing", "product", "plant", "sales", "admin", "finance"] as const;
export const BILL_STATUS = ["unpaid", "paid", "disputed"] as const;
export const BILL_CATEGORIES = ["ai", "materials", "services", "marketing", "rent", "utilities", "logistics", "travel", "equipment", "other"] as const;
export const OPEX_CATEGORIES = ["rent", "utilities", "software", "marketing", "logistics", "insurance", "professional", "maintenance", "other"] as const;

/* ---- the work board ---- */

export const listTasks = (): Task[] =>
  getDb().prepare("SELECT * FROM tasks ORDER BY start_date, end_date, title").all() as Task[];

export function saveTask(t: Partial<Task> & { title?: string }): Task {
  const db = getDb();
  const at = now();
  if (t.id) {
    const fields = ["title", "notes", "owner", "area", "start_date", "end_date", "status", "progress", "depends_on",
                    "estimate_minutes", "spent_minutes", "doable_by", "door", "kind", "priority"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (t[f] !== undefined) { sets.push(`${f} = ?`); vals.push(t[f]); }
    /* Marking a task done fills the bar in, so nobody has to say "done" twice. */
    if (t.status === "done" && t.progress === undefined) { sets.push("progress = ?"); vals.push(100); }
    if (sets.length) db.prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, t.id);
    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(t.id) as Task;
  }
  const id = newId();
  const start = t.start_date || at.slice(0, 10);
  db.prepare(`INSERT INTO tasks (id, title, notes, owner, area, start_date, end_date, status, progress, depends_on,
                                 estimate_minutes, spent_minutes, doable_by, door, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.title || "Untitled", t.notes || "", t.owner || "", t.area || "marketing",
      start, t.end_date || start, t.status || "planned", t.progress ?? 0, t.depends_on || null,
      t.estimate_minutes ?? 0, t.spent_minutes ?? 0, t.doable_by || "", t.door || "", at, at);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
}

/* ---- bills and stock ---- */

export const listBills = (): Bill[] =>
  getDb().prepare("SELECT * FROM bills ORDER BY bill_date DESC, created_at DESC").all() as Bill[];

export function saveBill(b: Partial<Bill>): Bill {
  const db = getDb();
  const at = now();
  if (b.id) {
    const fields = ["vendor", "number", "bill_date", "due_date", "amount", "tax", "category", "status", "file_id", "notes"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(b[f] === "" && f === "file_id" ? null : b[f]); }
    if (sets.length) db.prepare(`UPDATE bills SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, b.id);
    return db.prepare("SELECT * FROM bills WHERE id = ?").get(b.id) as Bill;
  }
  const id = newId();
  db.prepare(`INSERT INTO bills (id, vendor, number, bill_date, due_date, amount, tax, category, status, file_id, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.vendor || "", b.number || "", b.bill_date || at.slice(0, 10), b.due_date || "",
      b.amount || 0, b.tax || 0, b.category || "other", b.status || "unpaid", b.file_id || null, b.notes || "", at, at);
  return db.prepare("SELECT * FROM bills WHERE id = ?").get(id) as Bill;
}

export const listStock = (): StockItem[] =>
  getDb().prepare("SELECT * FROM stock ORDER BY item").all() as StockItem[];

export function saveStock(s: Partial<StockItem>): StockItem {
  const db = getDb();
  const at = now();
  if (s.id) {
    const fields = ["item", "sku", "category", "qty", "unit", "location", "reorder_at", "unit_cost", "counted_at", "notes", "per_month"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (s[f] !== undefined) { sets.push(`${f} = ?`); vals.push(s[f]); }
    /* Changing the quantity is a count, so it dates itself. */
    if (s.qty !== undefined && s.counted_at === undefined) { sets.push("counted_at = ?"); vals.push(at.slice(0, 10)); }
    if (sets.length) db.prepare(`UPDATE stock SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, s.id);
    return db.prepare("SELECT * FROM stock WHERE id = ?").get(s.id) as StockItem;
  }
  const id = newId();
  db.prepare(`INSERT INTO stock (id, item, sku, category, qty, unit, location, reorder_at, unit_cost, counted_at, notes, per_month, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.item || "", s.sku || "", s.category || "other", s.qty || 0, s.unit || "nos", s.location || "",
      s.reorder_at || 0, s.unit_cost || 0, s.counted_at || at.slice(0, 10), s.notes || "", s.per_month || 0, at, at);
  return db.prepare("SELECT * FROM stock WHERE id = ?").get(id) as StockItem;
}

/* ---- people and running costs ---- */

export const listPeople = (): Person[] =>
  getDb().prepare("SELECT * FROM people ORDER BY department, name").all() as Person[];

export function savePerson(p: Partial<Person>): Person {
  const db = getDb();
  const at = now();
  if (p.id) {
    const fields = ["name", "role", "department", "monthly_cost", "started_on", "ended_on", "kind", "notes"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (p[f] !== undefined) { sets.push(`${f} = ?`); vals.push(p[f]); }
    if (sets.length) db.prepare(`UPDATE people SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, p.id);
    return db.prepare("SELECT * FROM people WHERE id = ?").get(p.id) as Person;
  }
  const id = newId();
  db.prepare(`INSERT INTO people (id, name, role, department, monthly_cost, started_on, ended_on, kind, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, p.name || "", p.role || "", p.department || "", p.monthly_cost || 0,
      p.started_on || at.slice(0, 10), p.ended_on || "", p.kind || "payroll", p.notes || "", at, at);
  return db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Person;
}

export const listOpex = (): Opex[] =>
  getDb().prepare("SELECT * FROM opex ORDER BY category, item").all() as Opex[];

export function saveOpex(o: Partial<Opex>): Opex {
  const db = getDb();
  const at = now();
  if (o.id) {
    const fields = ["item", "category", "vendor", "monthly_cost", "starts_on", "ends_on", "notes"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (o[f] !== undefined) { sets.push(`${f} = ?`); vals.push(o[f]); }
    if (sets.length) db.prepare(`UPDATE opex SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, o.id);
    return db.prepare("SELECT * FROM opex WHERE id = ?").get(o.id) as Opex;
  }
  const id = newId();
  db.prepare(`INSERT INTO opex (id, item, category, vendor, monthly_cost, starts_on, ends_on, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, o.item || "", o.category || "other", o.vendor || "", o.monthly_cost || 0,
      o.starts_on || at.slice(0, 10), o.ends_on || "", o.notes || "", at, at);
  return db.prepare("SELECT * FROM opex WHERE id = ?").get(id) as Opex;
}

/* ---- AI subscriptions ---- */

export const SUB_STATUS = ["active", "paused", "cancelled"] as const;
export const SUB_CYCLES: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12, "2 years": 24, "3 years": 36, "one-off": 0 };
export const SUB_KINDS = ["Subscription", "Domain registration", "Ads", "Credits", "Other"] as const;
/* What a renewal works out to a month; a one-off is not a monthly cost. */
export const perMonth = (periodCost: number, cycle: string) => {
  const n = SUB_CYCLES[cycle] ?? 1;
  return n ? Math.round(periodCost / n) : 0;
};
/* An AI or automation tool, as opposed to LinkedIn or a domain: the P&L keeps them apart. */
export const isAiSub = (x: Pick<Subscription, "tool" | "card_name">) => isAiBill({ vendor: `${x.tool} ${x.card_name}`, category: "" });

export const listSubs = (): Subscription[] =>
  getDb().prepare("SELECT * FROM subscriptions ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, monthly_cost DESC, tool").all() as Subscription[];

export function saveSub(input: Partial<Subscription>): Subscription {
  const db = getDb();
  const at = now();
  const x = { ...input };
  if (x.cycle !== undefined && !(x.cycle in SUB_CYCLES)) x.cycle = "monthly";
  /* Nobody named means the team as a whole. */
  if (x.owner !== undefined && !x.owner.trim()) x.owner = "Marketing";
  /* The monthly figure always follows the price and how often it renews. */
  if (x.period_cost !== undefined || x.cycle !== undefined) {
    const was = x.id ? db.prepare("SELECT period_cost, cycle FROM subscriptions WHERE id = ?").get(x.id) as { period_cost: number; cycle: string } | undefined : undefined;
    x.monthly_cost = perMonth(x.period_cost ?? was?.period_cost ?? 0, x.cycle ?? was?.cycle ?? "monthly");
  } else if (x.monthly_cost !== undefined && !x.id) x.period_cost = x.monthly_cost;
  if (x.id) {
    const fields = ["tool", "plan", "monthly_cost", "billing_day", "card_name", "used_for", "status", "starts_on", "ends_on", "notes",
      "owner", "currency", "foreign_cost", "period_cost", "cycle", "kind", "card_holder", "last_paid"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (x[f] !== undefined) { sets.push(`${f} = ?`); vals.push(x[f]); }
    if (sets.length) db.prepare(`UPDATE subscriptions SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, x.id);
    return db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(x.id) as Subscription;
  }
  const id = newId();
  db.prepare(`INSERT INTO subscriptions (id, tool, plan, monthly_cost, billing_day, card_name, used_for, status, starts_on, ends_on, notes,
                owner, currency, foreign_cost, period_cost, cycle, kind, card_holder, last_paid, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, x.tool || "", x.plan || "", x.monthly_cost || 0, x.billing_day || 0, x.card_name || x.tool || "", x.used_for || "",
      x.status || "active", x.starts_on || at.slice(0, 10), x.ends_on || "", x.notes || "",
      x.owner || "Marketing", x.currency || "INR", x.foreign_cost || 0, x.period_cost || 0, x.cycle || "monthly", x.kind || "Subscription", x.card_holder || "", x.last_paid || "", at, at);
  return db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Subscription;
}

/* The company on the card is not always the tool's name: Claude is billed by Anthropic, ChatGPT
   by OpenAI, Grok by xAI. Each is read as the tool, so the charge finds its subscription. */
const ALIASES: [RegExp, string][] = [[/anthropic/g, "claude"], [/openai/g, "chatgpt"], [/supergrok/g, "grok"]];
const squash = (v: string) => ALIASES.reduce((s, [re, to]) => s.replace(re, to),
  v.toLowerCase().replace(/\bx\.?ai\b/g, "grok").replace(/[^a-z0-9]/g, ""));
/* Whether a card charge is this subscription: the name the card shows ("CLAUDE.AI SUBSCRIPTION",
   "OPENAI *CHATGPT") holds the name we gave it, or the other way round. */
export const chargeIsSub = (vendor: string, sub: Pick<Subscription, "tool" | "card_name">) => {
  const v = squash(vendor);
  return [sub.card_name, sub.tool].map(squash).filter((n) => n.length >= 3).some((n) => v.includes(n) || n.includes(v));
};
/* Running in a month: between its dates — and a cancelled one only up to the end date it was
   given, never open-ended. */
const subOn = (sub: Subscription, month: string): boolean =>
  activeIn(month, sub.starts_on, sub.ends_on) && (sub.status !== "cancelled" || Boolean(sub.ends_on));

/* Card charges matched to subscriptions. Three Claude seats are three charges called CLAUDE:
   each charge goes to the seat whose price it is nearest, so no seat is credited with the
   others'. What matches nothing is handed back. */
function assignCharges(charges: Bill[], subs: Subscription[]): { got: Map<string, number[]>; loose: Bill[] } {
  const got = new Map<string, number[]>();
  const loose: Bill[] = [];
  for (const b of [...charges].sort((p, q) => q.amount + q.tax - (p.amount + p.tax))) {
    const amt = b.amount + b.tax;
    const cands = subs.filter((x) => chargeIsSub(b.vendor, x));
    if (!cands.length) { loose.push(b); continue; }
    const free = cands.filter((x) => !got.has(x.id));
    const pick = (free.length ? free : cands).reduce((best, x) => (Math.abs(x.period_cost - amt) < Math.abs(best.period_cost - amt) ? x : best));
    got.set(pick.id, [...(got.get(pick.id) || []), amt]);
  }
  return { got, loose };
}

/* What the tools cost in a month, one subscription at a time: what the card charged for it
   that month when the charge has been entered, what the list says it costs when it has not.
   An AI charge that belongs to nothing on the list is counted as charged. So a month is never
   short because a bill is late, and never counted twice once it arrives. */
export type AiCost = { month: string; total: number; source: "card" | "list" | "mixed" | "none"; other: number };
export function aiCost(month: string, subs: Subscription[], bills: Bill[]): AiCost {
  const inMonth = bills.filter((b) => b.bill_date.slice(0, 7) === month && b.amount + b.tax);
  const running = subs.filter((x) => x.status !== "paused" && subOn(x, month));
  const { got, loose } = assignCharges(inMonth.filter((b) => isAiBill(b) || running.some((x) => chargeIsSub(b.vendor, x))), running);
  let ai = 0, other = 0, fromCard = 0, fromList = 0;
  const future = month > thisMonth();
  for (const x of running) {
    const charged = (got.get(x.id) || []).reduce((a, n) => a + n, 0);
    const amt = charged || (future ? 0 : x.monthly_cost);
    if (charged) fromCard++; else if (amt) fromList++;
    if (isAiSub(x)) ai += amt; else other += amt;
  }
  for (const b of loose) if (isAiBill(b)) { ai += b.amount + b.tax; fromCard++; }
  const source = fromCard && fromList ? "mixed" : fromCard ? "card" : fromList ? "list" : "none";
  return { month, total: ai, source, other };
}

/* The list beside the card for one month: what each subscription costs and what was charged
   for it, and the AI charges in the last three months that nothing on the list accounts for. */
export function subsCheck(month: string, subs: Subscription[] = listSubs(), bills: Bill[] = listBills()) {
  const shown = subs.filter((x) => x.status !== "cancelled" || subOn(x, month));
  const inMonth = bills.filter((b) => b.bill_date.slice(0, 7) === month && b.amount + b.tax && (isAiBill(b) || shown.some((x) => chargeIsSub(b.vendor, x))));
  const { got } = assignCharges(inMonth, shown);
  const rows = shown.map((x) => {
    const mine = got.get(x.id) || [];
    return { id: x.id, tool: x.tool, expected: x.status === "paused" ? 0 : x.period_cost, charged: mine.reduce((a, n) => a + n, 0), charges: mine.length };
  });
  const [from] = monthsBack(3, month);
  const loose = new Map<string, { vendor: string; amount: number; charges: number; month: string }>();
  for (const b of bills) {
    const m = b.bill_date.slice(0, 7);
    if (!(b.amount + b.tax) || !isAiBill(b) || m < from || m > month || subs.some((x) => chargeIsSub(b.vendor, x))) continue;
    const k = squash(b.vendor);
    const t = loose.get(k);
    if (!t || m > t.month) loose.set(k, { vendor: b.vendor.trim(), amount: b.amount + b.tax, charges: 1, month: m });
    else if (m === t.month) { t.amount += b.amount + b.tax; t.charges += 1; }
  }
  return { month, read: inMonth.length > 0, rows, unlisted: [...loose.values()].sort((a, b) => b.amount - a.amount) };
}

export function remove(table: "tasks" | "bills" | "stock" | "people" | "opex" | "subscriptions", id: string) {
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return { deleted: true };
}

/* ---- AI tools: opex that fills itself in ----

   For this team opex is, in practice, the AI and automation bill: Claude, ChatGPT, Grok,
   Higgsfield, Magnific, Zapier and the rest, every month. Each of those already arrives in Circuit as a bill — typed, or read
   off the card statement — so asking somebody to type it again as an opex line is how the two
   drift apart. A bill counts as an AI tool if its category says "ai" or its vendor is one we
   recognise; the list is a regular expression so adding a new tool is one word. */
const AI_VENDORS = /\b(claude|anthropic|openai|chatgpt|gpt|grok|xai|x\.ai|gemini|perplexity|midjourney|runway|elevenlabs|eleven ?labs|higgsfield|magnific|meshy|vizcom|kling|pika|suno|krea|leonardo|ideogram|heygen|synthesia|luma|freepik|cursor|copilot|jasper|descript|topaz|stability|zapier|make\.com|n8n)/i;
export const isAiBill = (b: Pick<Bill, "vendor" | "category">) => b.category === "ai" || AI_VENDORS.test(b.vendor || "");

export type AiMonth = { month: string; total: number; tools: { vendor: string; amount: number; bills: number }[] };
export function aiTools(month: string, bills: Bill[] = listBills()): AiMonth {
  const by = new Map<string, { vendor: string; amount: number; bills: number }>();
  for (const b of bills) {
    if (b.bill_date.slice(0, 7) !== month || !isAiBill(b) || !(b.amount + b.tax)) continue;
    const key = b.vendor.trim().toLowerCase();
    const t = by.get(key) || { vendor: b.vendor.trim(), amount: 0, bills: 0 };
    t.amount += b.amount + b.tax; t.bills += 1;
    by.set(key, t);
  }
  const tools = [...by.values()].sort((a, b) => b.amount - a.amount);
  return { month, total: tools.reduce((a, t) => a + t.amount, 0), tools };
}

/* ---- the month's profit and loss ---- */

export type PnlMonth = {
  month: string; revenue: number; cogs: number; gross: number;
  manpower: number; opex: number; ai: number; ai_source: AiCost["source"]; spend: number; other_in: number; other_out: number;
  costs: number; net: number; margin: number | null;
  bills: number; bills_unpaid: number; notes: string;
};

export function savePnl(row: { month: string } & Partial<PnlRow>): PnlRow {
  const db = getDb();
  const cur = db.prepare("SELECT * FROM pnl WHERE month = ?").get(row.month) as PnlRow | undefined;
  const merged = {
    revenue: row.revenue ?? cur?.revenue ?? 0,
    cogs: row.cogs ?? cur?.cogs ?? 0,
    other_in: row.other_in ?? cur?.other_in ?? 0,
    other_out: row.other_out ?? cur?.other_out ?? 0,
    notes: row.notes ?? cur?.notes ?? "",
  };
  db.prepare(`INSERT INTO pnl (month, revenue, cogs, other_in, other_out, notes, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(month) DO UPDATE SET revenue = excluded.revenue, cogs = excluded.cogs,
                other_in = excluded.other_in, other_out = excluded.other_out, notes = excluded.notes, updated_at = excluded.updated_at`)
    .run(row.month, merged.revenue, merged.cogs, merged.other_in, merged.other_out, merged.notes, now());
  return db.prepare("SELECT * FROM pnl WHERE month = ?").get(row.month) as PnlRow;
}

/* One month of the whole of marketing, built from the lists rather than retyped.

   Costs are four things: the people (from the salary list), the AI subscriptions (from the card
   once it has been read, from the subscriptions list until then), everything else that was
   billed in the month — ads, domains, printing — and any standing cost on the opex list. A
   bill and a standing line for the same thing would be the same rupee twice, so a repeating
   cost goes in one place: the opex list if it never changes, a bill if it does. */
export function pnlMonth(month: string, ctx?: { people: Person[]; opex: Opex[]; rows: Map<string, PnlRow>; bills: Bill[]; subs?: Subscription[] }): PnlMonth {
  const db = getDb();
  const people = ctx?.people ?? listPeople();
  const ops = ctx?.opex ?? listOpex();
  const row = ctx ? ctx.rows.get(month) : (db.prepare("SELECT * FROM pnl WHERE month = ?").get(month) as PnlRow | undefined);
  const bills = ctx?.bills ?? listBills();
  const subs = ctx?.subs ?? listSubs();

  const manpower = people.filter((p) => activeIn(month, p.started_on, p.ended_on)).reduce((a, p) => a + p.monthly_cost, 0);
  const aic = aiCost(month, subs, bills);
  const ai = aic.total;
  const opexTotal = ops.filter((o) => activeIn(month, o.starts_on, o.ends_on)).reduce((a, o) => a + o.monthly_cost, 0) + ai;
  const inMonth = bills.filter((b) => b.bill_date.slice(0, 7) === month);
  /* Everything else: the non-AI subscriptions (LinkedIn, a domain — charged or listed, as
     above), and every other bill in the month that is not one of them. */
  const subBill = (b: Bill) => subs.some((x) => x.status !== "paused" && subOn(x, month) && chargeIsSub(b.vendor, x));
  const spend = aic.other + inMonth.filter((b) => !isAiBill(b) && !subBill(b)).reduce((a, b) => a + b.amount + b.tax, 0);

  const revenue = row?.revenue || 0;
  const cogs = row?.cogs || 0;
  const otherIn = row?.other_in || 0;
  const otherOut = row?.other_out || 0;
  const gross = revenue - cogs;
  const costs = manpower + opexTotal + spend + otherOut;
  const net = gross + otherIn - costs;

  return {
    month, revenue, cogs, gross, manpower, opex: opexTotal, ai, ai_source: aic.source, spend,
    other_in: otherIn, other_out: otherOut, costs, net,
    margin: revenue ? Math.round((net / revenue) * 1000) / 10 : null,
    bills: inMonth.reduce((a, b) => a + b.amount + b.tax, 0),
    bills_unpaid: inMonth.filter((b) => b.status === "unpaid").reduce((a, b) => a + b.amount + b.tax, 0),
    notes: row?.notes || "",
  };
}

/* Several months at once, reading the lists exactly once. */
export function pnlRange(months: string[]): PnlMonth[] {
  const db = getDb();
  const ctx = {
    people: listPeople(),
    opex: listOpex(),
    bills: listBills(),
    subs: listSubs(),
    rows: new Map((db.prepare("SELECT * FROM pnl").all() as PnlRow[]).map((r) => [r.month, r])),
  };
  return months.map((m) => pnlMonth(m, ctx));
}

/* What Admin puts on top of its page. */
export function adminSummary() {
  const bills = listBills();
  const stock = listStock();
  const today = new Date().toISOString().slice(0, 10);
  const unpaid = bills.filter((b) => b.status === "unpaid");
  return {
    bills: bills.length,
    unpaid: unpaid.length,
    unpaid_value: unpaid.reduce((a, b) => a + b.amount + b.tax, 0),
    overdue: unpaid.filter((b) => b.due_date && b.due_date < today).length,
    this_month: bills.filter((b) => b.bill_date.slice(0, 7) === thisMonth()).reduce((a, b) => a + b.amount + b.tax, 0),
    items: stock.length,
    stock_value: stock.reduce((a, s) => a + Math.round(stockOutlook(s).left * s.unit_cost), 0),
    low: stock.filter((s) => stockOutlook(s).low).length,
    never_counted: stock.filter((s) => !s.counted_at).length,
  };
}

/* What Finance puts on top of its page: this month, and how it moved. */
export function financeSummary() {
  const [before, current] = pnlRange(monthsBack(2));
  const people = listPeople().filter((p) => activeIn(thisMonth(), p.started_on, p.ended_on));
  return {
    month: current, previous: before,
    headcount: people.length,
    payroll: people.filter((p) => p.kind === "payroll").length,
    contract: people.filter((p) => p.kind !== "payroll").length,
    opex_lines: listOpex().filter((o) => activeIn(thisMonth(), o.starts_on, o.ends_on)).length,
  };
}

/* ---- what marketing costs ---- */

/* The P&L above is a company's shape: revenue, cost of sales, margin. Marketing has none of
   those — it does not sell anything, so it has no revenue of its own and a margin would be a
   fiction. What it has is two salaries and a pile of AI subscriptions, and the only question
   worth asking is what that money bought.

   So this is the whole of it: the people on the team that month, every tool bill dated in that
   month, and the posts that actually went out. Not the posts that were planned — planned work
   costs the same as finished work and tells you nothing. */

export type MarketingMonth = {
  month: string;
  people: number; heads: number;
  tools: number; tool_lines: number;
  total: number;
  posted: number; planned: number;
  per_post: number | null;
};

export function marketingRange(months: string[]): MarketingMonth[] {
  const db = getDb();
  const people = listPeople();
  const bills = listBills();
  const posts = db.prepare("SELECT status, substr(scheduled_at, 1, 7) AS m FROM posts").all() as { status: string; m: string }[];

  return months.map((month) => {
    const on = people.filter((p) => activeIn(month, p.started_on, p.ended_on));
    const inMonth = bills.filter((b) => b.bill_date.slice(0, 7) === month);
    const mine = posts.filter((p) => p.m === month);

    const peopleCost = on.reduce((a, p) => a + p.monthly_cost, 0);
    const tools = inMonth.reduce((a, b) => a + b.amount + b.tax, 0);
    const total = peopleCost + tools;
    const posted = mine.filter((p) => p.status === "posted").length;

    return {
      month, people: peopleCost, heads: on.length,
      tools, tool_lines: inMonth.length, total,
      posted, planned: mine.length,
      /* No division when nothing went out. A blank says "nothing shipped this month", which is
         the thing worth noticing; a huge number would say the same thing far less clearly. */
      per_post: posted > 0 ? Math.round(total / posted) : null,
    };
  });
}
