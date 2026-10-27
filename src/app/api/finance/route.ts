import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import {
  listPeople, savePerson, listOpex, saveOpex, savePnl, pnlRange, remove,
  financeSummary, marketingRange, aiTools, listBills, OPEX_CATEGORIES, type Person, type Opex, type PnlRow,
} from "@/lib/books";
import { monthsBack } from "@/lib/money";

/* Salaries, opex and the P&L. Admin only, server-side — hiding the Finance tab from the menu
   was never the protection, because anybody signed in could ask this route directly. */
export const runtime = "nodejs";

export const GET = handleCan("finance", async (req) => {
  const n = Number(new URL(req.url).searchParams.get("months") || 12);
  const span = monthsBack(Math.min(Math.max(n, 3), 36));
  return ok({
    people: listPeople(), opex: listOpex(),
    pnl: pnlRange(span), marketing: marketingRange(span),
    ai: (() => { const bills = listBills(); return span.map((m) => aiTools(m, bills)).reverse(); })(),
    summary: financeSummary(), categories: OPEX_CATEGORIES,
  });
});

type Body = { what?: "person" | "opex" | "pnl"; month?: string } & Partial<Person> & Partial<Opex> & Partial<PnlRow>;

export const POST = handleCan("finance", async (req) => {
  const b = await readJson<Body>(req);
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
  return ok(b.what === "opex" ? saveOpex(b) : savePerson(b));
});

export const DELETE = handleCan("finance", async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const what = url.searchParams.get("what");
  if (!id) return bad("id required");
  return ok(remove(what === "opex" ? "opex" : "people", id));
});
