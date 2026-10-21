import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import { listBrands, activeBrand, setActiveBrand, createBrand } from "@/lib/db";

export const runtime = "nodejs";

/* The brands the agency runs, and which one is in front.

   Each brand is its own database and its own pictures directory, so switching is not a filter
   applied to a shared pile — it is a different file being opened. Nothing can leak across,
   because there is nothing to leak through. */

export const GET = handle(async () => {
  const active = activeBrand();
  return ok({ brands: listBrands(), active: active ? active.slug : "" });
});

/* Adding a brand creates a place for it to live. Only somebody who can manage: a new brand is a new set of
   books, not a view setting. */
export const POST = handleCan("manage", async (req) => {
  const b = await readJson<{ name?: string }>(req);
  try {
    return ok(createBrand(b.name || ""), 201);
  } catch (e) {
    return bad((e as Error).message);
  }
});

/* Switching is an everyday act, so anyone signed in may do it. */
export const PATCH = handle(async (req) => {
  const b = await readJson<{ slug?: string }>(req);
  if (!b.slug) return bad("Which brand?");
  try {
    return ok({ active: setActiveBrand(b.slug).slug, brands: listBrands() });
  } catch (e) {
    return bad((e as Error).message, 404);
  }
});
