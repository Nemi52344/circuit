import { handle, ok, bad } from "@/lib/http";
import { getConversation, ideasJob, slotsNeedingIdeas } from "@/lib/conversation";

export const runtime = "nodejs";

export const GET = handle(async (req) => {
  const month = new URL(req.url).searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) return bad("month must look like 2026-10");
  const c = getConversation(month);
  return ok({
    job: ideasJob(month) || null,
    open_slots: slotsNeedingIdeas(month).length,
    conversation: c ? {
      gathered_at: c.gathered_at, seeds: c.seeds, errors: c.errors,
      counts: { google: c.google.reduce((a, x) => a + x.suggestions.length, 0), youtube: c.youtube.reduce((a, x) => a + x.suggestions.length, 0), news: c.news.length, reddit: c.reddit.length, trends: c.trends.length, meta_ads: c.meta_ads.length, instagram: c.instagram.reduce((a, x) => a + x.posts.length, 0) },
    } : null,
  });
});
