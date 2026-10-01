import { getDb, newId, now } from "@/lib/db";
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
};
export type Bill = {
  id: string; vendor: string; number: string; bill_date: string; due_date: string;
  amount: number; tax: number; category: string; status: string; file_id: string | null;
  notes: string; created_at: string; updated_at: string;
};
export type StockItem = {
  id: string; item: string; sku: string; category: string; qty: number; unit: string;
  location: string; reorder_at: number; unit_cost: number; counted_at: string; notes: string;
  created_at: string; updated_at: string;
};
export type Person = {
  id: string; name: string; role: string; department: string; monthly_cost: number;
  started_on: string; ended_on: string; kind: string; notes: string; created_at: string; updated_at: string;
};
export type Opex = {
  id: string; item: string; category: string; vendor: string; monthly_cost: number;
  starts_on: string; ends_on: string; notes: string; created_at: string; updated_at: string;
};
export type PnlRow = { month: string; revenue: number; cogs: number; other_in: number; other_out: number; notes: string; updated_at: string };

export const TASK_STATUS = ["planned", "doing", "blocked", "done"] as const;
export const TASK_AREAS = ["marketing", "product", "plant", "sales", "admin", "finance"] as const;
export const BILL_STATUS = ["unpaid", "paid", "disputed"] as const;
export const BILL_CATEGORIES = ["materials", "services", "marketing", "rent", "utilities", "logistics", "travel", "equipment", "other"] as const;
export const OPEX_CATEGORIES = ["rent", "utilities", "software", "marketing", "logistics", "insurance", "professional", "maintenance", "other"] as const;

/* ---- the work board ---- */

export const listTasks = (): Task[] =>
  getDb().prepare("SELECT * FROM tasks ORDER BY start_date, end_date, title").all() as Task[];

export function saveTask(t: Partial<Task> & { title?: string }): Task {
  const db = getDb();
  const at = now();
  if (t.id) {
    const fields = ["title", "notes", "owner", "area", "start_date", "end_date", "status", "progress", "depends_on"] as const;
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
  db.prepare(`INSERT INTO tasks (id, title, notes, owner, area, start_date, end_date, status, progress, depends_on, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.title || "Untitled", t.notes || "", t.owner || "", t.area || "marketing",
      start, t.end_date || start, t.status || "planned", t.progress ?? 0, t.depends_on || null, at, at);
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
    const fields = ["item", "sku", "category", "qty", "unit", "location", "reorder_at", "unit_cost", "counted_at", "notes"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) if (s[f] !== undefined) { sets.push(`${f} = ?`); vals.push(s[f]); }
    /* Changing the quantity is a count, so it dates itself. */
    if (s.qty !== undefined && s.counted_at === undefined) { sets.push("counted_at = ?"); vals.push(at.slice(0, 10)); }
    if (sets.length) db.prepare(`UPDATE stock SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, at, s.id);
    return db.prepare("SELECT * FROM stock WHERE id = ?").get(s.id) as StockItem;
  }
  const id = newId();
  db.prepare(`INSERT INTO stock (id, item, sku, category, qty, unit, location, reorder_at, unit_cost, counted_at, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.item || "", s.sku || "", s.category || "other", s.qty || 0, s.unit || "nos", s.location || "",
      s.reorder_at || 0, s.unit_cost || 0, s.counted_at || at.slice(0, 10), s.notes || "", at, at);
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

export function remove(table: "tasks" | "bills" | "stock" | "people" | "opex", id: string) {
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return { deleted: true };
}

/* ---- the month's profit and loss ---- */

export type PnlMonth = {
  month: string; revenue: number; cogs: number; gross: number;
  manpower: number; opex: number; other_in: number; other_out: number;
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

/* One month, built from the standing lines rather than retyped.

   Bills are reported beside the result, not inside it. A bill for rent and a rent line in opex
   are the same rupee, and counting both would quietly double the month's costs. */
export function pnlMonth(month: string, ctx?: { people: Person[]; opex: Opex[]; rows: Map<string, PnlRow>; bills: Bill[] }): PnlMonth {
  const db = getDb();
  const people = ctx?.people ?? listPeople();
  const ops = ctx?.opex ?? listOpex();
  const row = ctx ? ctx.rows.get(month) : (db.prepare("SELECT * FROM pnl WHERE month = ?").get(month) as PnlRow | undefined);
  const bills = ctx?.bills ?? listBills();

  const manpower = people.filter((p) => activeIn(month, p.started_on, p.ended_on)).reduce((a, p) => a + p.monthly_cost, 0);
  const opexTotal = ops.filter((o) => activeIn(month, o.starts_on, o.ends_on)).reduce((a, o) => a + o.monthly_cost, 0);
  const inMonth = bills.filter((b) => b.bill_date.slice(0, 7) === month);

  const revenue = row?.revenue || 0;
  const cogs = row?.cogs || 0;
  const otherIn = row?.other_in || 0;
  const otherOut = row?.other_out || 0;
  const gross = revenue - cogs;
  const costs = manpower + opexTotal + otherOut;
  const net = gross + otherIn - costs;

  return {
    month, revenue, cogs, gross, manpower, opex: opexTotal,
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
    stock_value: stock.reduce((a, s) => a + Math.round(s.qty * s.unit_cost), 0),
    low: stock.filter((s) => s.reorder_at > 0 && s.qty <= s.reorder_at).length,
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
