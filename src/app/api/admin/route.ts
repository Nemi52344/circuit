import { handle, ok, bad, readJson } from "@/lib/http";
import {
  listBills, saveBill, listStock, saveStock, remove, adminSummary,
  BILL_STATUS, BILL_CATEGORIES, type Bill, type StockItem,
} from "@/lib/books";

export const runtime = "nodejs";

export const GET = handle(async () => ok({
  bills: listBills(), stock: listStock(), summary: adminSummary(),
  statuses: BILL_STATUS, categories: BILL_CATEGORIES,
}));

type Body = { what?: "bill" | "stock" } & Partial<Bill> & Partial<StockItem>;

export const POST = handle(async (req) => {
  const b = await readJson<Body>(req);
  if (b.what === "stock") {
    if (!b.item?.trim()) return bad("An item needs a name");
    return ok(saveStock(b), 201);
  }
  if (!b.vendor?.trim()) return bad("A bill needs a vendor");
  if (b.status && !BILL_STATUS.includes(b.status as (typeof BILL_STATUS)[number])) return bad("Unknown status");
  return ok(saveBill(b), 201);
});

export const PATCH = handle(async (req) => {
  const b = await readJson<Body>(req);
  if (!b.id) return bad("id required");
  return ok(b.what === "stock" ? saveStock(b) : saveBill(b));
});

export const DELETE = handle(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const what = url.searchParams.get("what");
  if (!id) return bad("id required");
  return ok(remove(what === "stock" ? "stock" : "bills", id));
});
