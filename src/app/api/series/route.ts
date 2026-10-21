import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import { listSeries, saveSeries, removeSeries, fillSeries, DAYS, type Series } from "@/lib/series";

export const runtime = "nodejs";

export const GET = handle(async () => ok({ series: listSeries(), days: DAYS }));

export const POST = handleCan("create", async (req) => {
  const b = await readJson<Partial<Series> & { action?: string; weeks?: number; id?: string }>(req);
  /* Putting the next few weeks on the calendar. Safe to press twice: it will not write into the
     past and will not add a second post where this series already has one. */
  if (b.action === "fill") {
    const filled = fillSeries(Math.max(1, Math.min(52, b.weeks || 8)), b.id);
    /* Asking to fill one series that cannot be filled is a failed request, not a quiet success
       with an empty result. Across all of them it is a partial outcome, so the list is returned
       and the page says which ones were left alone. */
    if (b.id && filled[0]?.refused) return bad(filled[0].refused);
    return ok({ filled }, 201);
  }
  try { return ok(saveSeries(b), b.id ? 200 : 201); }
  catch (e) { return bad((e as Error).message); }
});

export const PATCH = handleCan("create", async (req) => {
  const b = await readJson<Partial<Series>>(req);
  if (!b.id) return bad("id required");
  try { return ok(saveSeries(b)); }
  catch (e) { return bad((e as Error).message); }
});

export const DELETE = handleCan("create", async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(removeSeries(id));
});
