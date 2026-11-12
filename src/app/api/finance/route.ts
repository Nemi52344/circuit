import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import {
  listPeople, savePerson, listOpex, saveOpex, savePnl, pnlRange, remove,
  financeSummary, marketingRange, aiTools, listBills, OPEX_CATEGORIES, type Person, type Opex, type PnlRow,
  listSubs, saveSub, subsCheck, isAiBill, chargeIsSub, isAiSub, SUB_STATUS, SUB_CYCLES, SUB_KINDS, type Subscription,
} from "@/lib/books";
import { monthsBack, thisMonth } from "@/lib/money";

/* Salaries, opex and the P&L. Admin only, server-side — hiding the Finance tab from the menu
   was never the protection, because anybody signed in could ask this route directly. */
export const runtime = "nodejs";

/* The latest month the card has been read for, so the check beside the list is about real
   charges; this month until a statement has been loaded. */
function lastReadMonth(): string {
  const months = listBills().filter((b) => isAiBill(b) && b.amount + b.tax).map((b) => b.bill_date.slice(0, 7)).sort();
  return months[months.length - 1] || thisMonth();
}

export const GET = handleCan("finance", async (req) => {
  const n = Number(new URL(req.url).searchParams.get("months") || 12);
  const span = monthsBack(Math.min(Math.max(n, 3), 36));
  return ok({
    subs: listSubs().map((x) => ({ ...x, ai: isAiSub(x) })), sub_status: SUB_STATUS, sub_cycles: Object.keys(SUB_CYCLES), sub_kinds: SUB_KINDS,
    sub_check: subsCheck(lastReadMonth()),
    people: listPeople(), opex: listOpex(),
    pnl: pnlRange(span), marketing: marketingRange(span),
    ai: (() => { const bills = listBills(); return span.map((m) => aiTools(m, bills)).reverse(); })(),
    summary: financeSummary(), categories: OPEX_CATEGORIES,
  });
});

type Body = { what?: "person" | "opex" | "pnl" | "sub" | "sub_from_card"; month?: string; vendor?: string } & Partial<Person> & Partial<Opex> & Partial<PnlRow> & Partial<Subscription>;

/* A tool seen on the card and not on the list, added in one go: the name it shows on the card,
   the latest month's charge as its monthly cost, running since its first charge. */
function subFromCard(vendor: string): Subscription {
  const mine = listBills().filter((b) => isAiBill(b) && b.amount + b.tax && chargeIsSub(b.vendor, { tool: vendor, card_name: vendor })).sort((a, b) => a.bill_date.localeCompare(b.bill_date));
  if (!mine.length) throw new Error("No charge from that tool on the card");
  const last = mine[mine.length - 1].bill_date.slice(0, 7);
  const monthly = mine.filter((b) => b.bill_date.slice(0, 7) === last).reduce((a, b) => a + b.amount + b.tax, 0);
  const name = vendor.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return saveSub({ tool: name, card_name: vendor.trim(), monthly_cost: monthly, starts_on: `${mine[0].bill_date.slice(0, 7)}-01`, billing_day: Number(mine[mine.length - 1].bill_date.slice(8, 10)) || 0 });
}

export const POST = handleCan("finance", async (req) => {
  const b = await readJson<Body>(req);
  if (b.what === "sub") {
    if (!b.tool?.trim()) return bad("A subscription needs the tool's name");
    return ok(saveSub(b), 201);
  }
  if (b.what === "sub_from_card") {
    if (!b.vendor?.trim()) return bad("Which tool?");
    try { return ok(subFromCard(b.vendor), 201); } catch (e) { return bad((e as Error).message); }
  }
  if (b.what === "opex") {
    if (!b.item?.trim()) return bad("A cost needs a name");
    return ok(saveOpex(b), 201);
  }
  if (b.what === "pnl") {
    if (!/^\d{4}-\d{2}$/.test(b.month || "")) return bad("A month like 2026-09 is needed");
    return ok(savePnl({ ...b, month: b.month as string }), 201);
  }
  if (!b.name?.trim()) return bad("A person needs a name");
  return ok(savePerson(b), 201);
});

export const PATCH = handleCan("finance", async (req) => {
  const b = await readJson<Body>(req);
  if (b.what === "pnl") {
    if (!/^\d{4}-\d{2}$/.test(b.month || "")) return bad("A month like 2026-09 is needed");
    return ok(savePnl({ ...b, month: b.month as string }));
  }
  if (!b.id) return bad("id required");
  if (b.what === "sub") {
    if (b.status !== undefined && !(SUB_STATUS as readonly string[]).includes(b.status)) return bad("Status is active, paused or cancelled");
    return ok(saveSub(b));
  }
  return ok(b.what === "opex" ? saveOpex(b) : savePerson(b));
});

export const DELETE = handleCan("finance", async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const what = url.searchParams.get("what");
  if (!id) return bad("id required");
  return ok(remove(what === "opex" ? "opex" : what === "sub" ? "subscriptions" : "people", id));
});
