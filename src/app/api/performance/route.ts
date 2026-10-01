import { handle, ok, readJson } from "@/lib/http";
import { learned } from "@/lib/learn";
import { syncOwnInstagram, lastInsightsRun, ownPosts } from "@/lib/insights";

export const runtime = "nodejs";

export const GET = handle(async () => ok({ ...learned(), own: ownPosts(12), last_sync: lastInsightsRun() }));

/* "Get my numbers" — reads our own Instagram posts and their insights, writes metrics rows. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; limit?: number }>(req);
  if (b.action === "sync") {
    const run = await syncOwnInstagram(b.limit || 30);
    return ok({ ...learned(), own: ownPosts(12), last_sync: run });
  }
  return ok({ ...learned(), own: ownPosts(12), last_sync: lastInsightsRun() });
});
