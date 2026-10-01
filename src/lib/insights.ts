import { getDb, getSetting, setSetting, newId, now, saveFileBuffer } from "@/lib/db";
import { fetchUrl } from "@/lib/sources";
import { getMetaToken, callMeta } from "@/lib/meta";

/* Our own numbers, fetched instead of typed. Reads BNC's Instagram posts and their insights
   through the same connection that reads competitors, stores them in own_posts, and writes a
   metrics row against the Circuit post whenever the pasted link matches. Everything here is
   read-only: nothing is published, edited or deleted on Instagram. */

export type OwnPost = {
  id: string; ig_id: string; permalink: string; type: string; caption: string; posted_at: string;
  likes: number; comments: number; reach: number | null; saved: number | null; shares: number | null;
  file_id: string | null; fetched_at: string;
};
export type InsightsRun = { at: string; read: number; stored: number; matched: number; errors: string[] };

const shortcode = (url: string) => (url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1] || "";

export function lastInsightsRun(): InsightsRun | null {
  try { return JSON.parse(getSetting("own_insights_last") || "null"); } catch { return null; }
}

export function insightsDue(hours = 6) {
  const last = lastInsightsRun();
  if (!getMetaToken() || !getSetting("ig_user_id")) return false;
  if (!last) return true;
  const gap = last.errors.length && !last.stored ? 1 : hours;
  return Date.now() - new Date(last.at).getTime() > gap * 3600000;
}

/* Insight names differ by post type and Meta retires them regularly, so each is asked for
   on its own and a refusal just leaves that number empty. */
/* Instagram's picture addresses expire, so a copy is kept here. That copy is what lets Circuit
   look at the poster itself later and learn what the winning ones have in common. */
async function keepPicture(url: string, igId: string): Promise<string | null> {
  try {
    const r = await fetchUrl(url, { accept: "image/*,*/*", maxBytes: 12_000_000, timeoutMs: 20000 });
    const ct = r.contentType.split(";")[0].trim();
    if (!r.ok || !ct.startsWith("image/")) return null;
    return saveFileBuffer(r.buffer, `ig-${igId}.${ct.includes("png") ? "png" : "jpg"}`, ct, "own_post").id;
  } catch {
    return null;
  }
}

async function insightsFor(mediaId: string, token: string, type: string) {
  const wanted = type === "REEL" ? ["reach", "saved", "shares"] : ["reach", "saved", "shares"];
  const out: Record<string, number | null> = { reach: null, saved: null, shares: null };
  for (const metric of wanted) {
    try {
      const r = (await callMeta(`${mediaId}/insights`, { metric }, token)) as { data?: { name: string; values?: { value?: number }[] }[] };
      const v = r.data?.[0]?.values?.[0]?.value;
      if (typeof v === "number") out[metric] = v;
    } catch { /* this metric isn't available for this post type */ }
  }
  return out;
}

export async function syncOwnInstagram(limit = 30): Promise<InsightsRun> {
  const token = getMetaToken();
  const igUser = getSetting("ig_user_id");
  const run: InsightsRun = { at: now(), read: 0, stored: 0, matched: 0, errors: [] };
  if (!token || !igUser) {
    run.errors.push("Connect Instagram in Settings first");
    setSetting("own_insights_last", JSON.stringify(run));
    return run;
  }
  const db = getDb();
  try {
    const body = (await callMeta(`${igUser}/media`, {
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url",
      limit: String(limit),
    }, token)) as { data?: { id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number; media_url?: string; thumbnail_url?: string }[] };
    const media = body.data || [];
    run.read = media.length;

    for (const m of media) {
      const type = m.media_product_type === "REELS" ? "REEL" : m.media_type || "IMAGE";
      const ins = await insightsFor(m.id, token, type);
      const row: OwnPost = {
        id: newId(), ig_id: m.id, permalink: m.permalink || "", type,
        caption: m.caption || "", posted_at: m.timestamp || "",
        likes: m.like_count || 0, comments: m.comments_count || 0,
        reach: ins.reach, saved: ins.saved, shares: ins.shares, file_id: null, fetched_at: now(),
      };
      const existing = db.prepare("SELECT id, file_id FROM own_posts WHERE ig_id = ?").get(m.id) as { id: string; file_id: string | null } | undefined;
      // a reel's own frame is its thumbnail; a picture post has media_url
      const picture = type === "REEL" ? m.thumbnail_url || m.media_url : m.media_url || m.thumbnail_url;
      if (existing) {
        const file_id = existing.file_id || (picture ? await keepPicture(picture, m.id) : null);
        db.prepare("UPDATE own_posts SET caption = ?, likes = ?, comments = ?, reach = ?, saved = ?, shares = ?, file_id = ?, fetched_at = ? WHERE id = ?")
          .run(row.caption, row.likes, row.comments, row.reach, row.saved, row.shares, file_id, row.fetched_at, existing.id);
      } else {
        const file_id = picture ? await keepPicture(picture, m.id) : null;
        db.prepare(`INSERT INTO own_posts (id, ig_id, permalink, type, caption, posted_at, likes, comments, reach, saved, shares, file_id, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.id, row.ig_id, row.permalink, row.type, row.caption, row.posted_at, row.likes, row.comments, row.reach, row.saved, row.shares, file_id, row.fetched_at);
      }
      run.stored++;

      // the post the owner pasted the link into, if any
      const code = shortcode(row.permalink);
      if (!code) continue;
      const post = db.prepare("SELECT id FROM posts WHERE posted_url LIKE ?").get(`%${code}%`) as { id: string } | undefined;
      if (!post) continue;
      const had = db.prepare("SELECT id FROM metrics WHERE post_id = ? AND source = 'instagram'").get(post.id) as { id: string } | undefined;
      if (had) {
        db.prepare("UPDATE metrics SET reach = ?, likes = ?, comments = ?, shares = ?, notes = ?, collected_at = ? WHERE id = ?")
          .run(row.reach, row.likes, row.comments, row.shares, row.saved === null ? "" : `${row.saved} saves`, now(), had.id);
      } else {
        db.prepare(`INSERT INTO metrics (id, post_id, source, period, impressions, reach, likes, comments, shares, clicks, notes, collected_at)
                    VALUES (?, ?, 'instagram', 'lifetime', NULL, ?, ?, ?, ?, NULL, ?, ?)`)
          .run(newId(), post.id, row.reach, row.likes, row.comments, row.shares, row.saved === null ? "" : `${row.saved} saves`, now());
      }
      run.matched++;
    }
  } catch (e) {
    run.errors.push((e as Error).message);
  }
  setSetting("own_insights_last", JSON.stringify(run));
  return run;
}

export function ownPosts(limit = 30): OwnPost[] {
  return getDb().prepare("SELECT * FROM own_posts ORDER BY posted_at DESC LIMIT ?").all(limit) as OwnPost[];
}
