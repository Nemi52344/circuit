import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import { stockOutlook } from "@/lib/stockmath";
import {
  listBills, saveBill, listStock, saveStock, remove, adminSummary,
  BILL_STATUS, BILL_CATEGORIES, type Bill, type StockItem,
} from "@/lib/books";

/* Bills, payments and stock. A Marketing Manager runs the spend on tools and suppliers; an
   Executive or a Viewer has no reason to read or change it. */
export const runtime = "nodejs";

export const GET = handleCan("manage", async () => ok({
  bills: listBills(), stock: listStock().map((s) => ({ ...s, outlook: stockOutlook(s) })), summary: adminSummary(),
  statuses: BILL_STATUS, categories: BILL_CATEGORIES,
}));

type Body = { what?: "bill" | "stock" } & Partial<Bill> & Partial<StockItem>;

export const POST = handleCan("manage", async (req) => {
  const b = await readJson<Body>(req);
  if (b.what === "stock") {
    if (!b.item?.trim()) return bad("An item needs a name");
    return ok(saveStock(b), 201);
  }
  if (!b.vendor?.trim()) return bad("A bill needs a vendor");
  if (b.status && !BILL_STATUS.includes(b.status as (typeof BILL_STATUS)[number])) return bad("Unknown status");
  return ok(saveBill(b), 201);
});

export const PATCH = handleCan("manage", async (req) => {
  const b = await readJson<Body>(req);
  if (!b.id) return bad("id required");
  return ok(b.what === "stock" ? saveStock(b) : saveBill(b));
});

export const DELETE = handleCan("manage", async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const what = url.searchParams.get("what");
  if (!id) return bad("id required");
  return ok(remove(what === "stock" ? "stock" : "bills", id));
});
