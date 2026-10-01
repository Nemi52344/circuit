import { getSetting, setSetting } from "@/lib/db";
import { fetchUrl } from "@/lib/sources";

/* Meta Ad Library, official API only (graph.facebook.com/ads_archive).
   The token is the user's own, stored locally, sent only to Meta. No scraping of the Ad Library website. */

export const META_API_VERSION = "v21.0";
export const AD_FIELDS = [
  "id", "page_id", "page_name", "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
  "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions", "ad_creative_link_captions",
  "ad_snapshot_url", "publisher_platforms", "languages", "currency", "spend", "impressions", "target_locations", "bylines",
].join(",");

export type MetaAd = {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_snapshot_url?: string;
  publisher_platforms?: string[];
  languages?: string[];
  currency?: string;
  spend?: { lower_bound?: string; upper_bound?: string };
  impressions?: { lower_bound?: string; upper_bound?: string };
  bylines?: string;
};

export const getMetaToken = () => getSetting("meta_token");

/* Meta's own message is passed through rather than replaced with a guess. */
function metaError(body: { error?: { message?: string; code?: number; error_user_msg?: string; error_user_title?: string } }, status: number) {
  const e = body.error;
  if (!e) return `Meta returned HTTP ${status}`;
  const detail = e.error_user_msg || e.message || "Unknown error";
  const hint =
    e.code === 190
      ? " The token is invalid or expired. Generate a new one in the Graph API Explorer."
      : e.code === 100 || e.code === 1
        ? " Check that your Meta app has Ad Library access and that the token carries it."
        : "";
  return `Meta: ${detail}${hint}`;
}

export async function callMeta(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetchUrl(url.toString(), { accept: "application/json", maxBytes: 8_000_000, timeoutMs: 25000 });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(r.buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`Meta returned a non-JSON response (HTTP ${r.status})`);
  }
  if (!r.ok || body.error) throw new Error(metaError(body as { error?: { message?: string; code?: number } }, r.status));
  return body;
}

/* A token can be perfectly good for Instagram and still have no Ad Library access, so the token
   itself is checked first and each capability is reported separately. */
export async function testMetaToken(token: string) {
  const me = (await callMeta("me", { fields: "id,name" }, token)) as { name?: string };
  const can = { ads: false, instagram: false };
  let adsError = "";
  try {
    await callMeta("ads_archive", { search_terms: "test", ad_reached_countries: '["IN"]', ad_type: "ALL", limit: "1", fields: "id" }, token);
    can.ads = true;
  } catch (e) {
    adsError = (e as Error).message;
  }
  try {
    can.instagram = (await discoverInstagramAccounts(token)).length > 0;
  } catch {
    can.instagram = false;
  }
  const parts = [
    `Token accepted${me.name ? ` for ${me.name}` : ""}.`,
    can.instagram ? "Instagram competitor posts are available." : "No Instagram professional account is reachable yet: link it to a Facebook Page and include instagram_basic and pages_show_list.",
    can.ads ? "Ad Library search is available." : "Ad Library search is not available: add the ads_read permission if you want competitor ads.",
  ];
  return { ok: true, message: parts.join(" "), can, ads_error: adsError };
}

export type AdSearch = { terms?: string; pageIds?: string; country?: string; activeOnly?: boolean; limit?: number; after?: string };

export async function searchAds(s: AdSearch) {
  const token = getMetaToken();
  if (!token) throw new Error("needs_meta_token");
  const country = (s.country || "IN").toUpperCase().slice(0, 2);
  const params: Record<string, string> = {
    ad_reached_countries: JSON.stringify([country]),
    ad_type: "ALL",
    ad_active_status: s.activeOnly === false ? "ALL" : "ACTIVE",
    fields: AD_FIELDS,
    limit: String(Math.min(Math.max(s.limit || 25, 1), 100)),
  };
  if (s.pageIds?.trim()) params.search_page_ids = JSON.stringify(s.pageIds.split(/[\s,]+/).filter(Boolean).slice(0, 10));
  else if (s.terms?.trim()) params.search_terms = s.terms.trim();
  else throw new Error("Give a search term or a page id");
  if (s.after) params.after = s.after;
  const body = (await callMeta("ads_archive", params, token)) as { data?: MetaAd[]; paging?: { cursors?: { after?: string }; next?: string } };
  const ads = body.data || [];
  return { ads, after: body.paging?.next ? body.paging?.cursors?.after || "" : "", country };
}

export function adText(a: MetaAd) {
  return [a.ad_creative_link_titles?.[0], a.ad_creative_bodies?.[0], a.ad_creative_link_descriptions?.[0]].filter(Boolean).join(" · ");
}
export function adRange(v?: { lower_bound?: string; upper_bound?: string }) {
  if (!v) return "";
  const lo = v.lower_bound;
  const hi = v.upper_bound;
  if (lo && hi) return `${Number(lo).toLocaleString("en-IN")}–${Number(hi).toLocaleString("en-IN")}`;
  if (lo) return `${Number(lo).toLocaleString("en-IN")}+`;
  return hi ? `up to ${Number(hi).toLocaleString("en-IN")}` : "";
}

/* ---------- Instagram competitor posts (Business Discovery, official Graph API) ----------
   Needs the user's own Instagram professional account id and a token with instagram_basic.
   Returns each competitor's latest posts with likes and comments, and flags the ones doing
   unusually well for that account (at least twice its median engagement). */
export type IgPost = { caption: string; likes: number; comments: number; type: string; permalink: string; timestamp: string; media_url: string; standout: boolean };
export type IgAccount = { handle: string; followers: number; posts: IgPost[] };

export async function igCompetitorPosts(handle: string, limit = 12): Promise<IgAccount> {
  const token = getMetaToken();
  const igUser = getSetting("ig_user_id");
  if (!token || !igUser) throw new Error("needs_instagram_account");
  const h = handle.replace(/^@/, "").trim();
  const fields = `business_discovery.username(${h}){username,followers_count,media.limit(${limit}){caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url}}`;
  const body = (await callMeta(igUser, { fields }, token)) as {
    business_discovery?: { followers_count?: number; media?: { data?: { caption?: string; like_count?: number; comments_count?: number; media_type?: string; media_product_type?: string; permalink?: string; timestamp?: string; media_url?: string; thumbnail_url?: string }[] } };
  };
  const media = body.business_discovery?.media?.data || [];
  const eng = media.map((m) => (m.like_count || 0) + (m.comments_count || 0)).sort((a, b) => a - b);
  const median = eng.length ? eng[Math.floor(eng.length / 2)] : 0;
  return {
    handle: h,
    followers: body.business_discovery?.followers_count || 0,
    posts: media.map((m) => {
      const e = (m.like_count || 0) + (m.comments_count || 0);
      const type = m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : m.media_type === "VIDEO" ? "Video" : "Static post";
      return { caption: (m.caption || "").slice(0, 400), likes: m.like_count || 0, comments: m.comments_count || 0, type, permalink: m.permalink || "", timestamp: m.timestamp || "", media_url: m.thumbnail_url || m.media_url || "", standout: median > 0 && e >= 2 * median };
    }),
  };
}

/* Finds the owner's own Instagram professional account from their token, so nobody has to hunt
   for a 17-digit id: every Facebook Page they manage is listed with the IG account linked to it. */
export type IgAccountChoice = { page_id: string; page_name: string; ig_user_id: string; username: string; followers: number };

export async function discoverInstagramAccounts(token?: string): Promise<IgAccountChoice[]> {
  const t = token || getMetaToken();
  if (!t) throw new Error("Save your Meta token first");
  const body = (await callMeta("me/accounts", { fields: "id,name,instagram_business_account{id,username,followers_count}", limit: "50" }, t)) as {
    data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string; followers_count?: number } }[];
  };
  return (body.data || [])
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({
      page_id: p.id,
      page_name: p.name,
      ig_user_id: p.instagram_business_account!.id,
      username: p.instagram_business_account!.username || "",
      followers: p.instagram_business_account!.followers_count || 0,
    }));
}

/* What Meta itself says about a token: when it runs out and what it is allowed to do.
   Circuit stores both, so it can warn before the token dies and show which permissions are
   missing for publishing, comments or ads instead of failing later with a cryptic error. */
export type TokenInfo = { valid: boolean; expires_at: string; never: boolean; scopes: string[]; app: string };

export async function tokenInfo(token: string): Promise<TokenInfo | null> {
  try {
    const r = (await callMeta("debug_token", { input_token: token }, token)) as {
      data?: { is_valid?: boolean; expires_at?: number; scopes?: string[]; application?: string };
    };
    const d = r.data;
    if (!d) return null;
    const never = !d.expires_at;
    return {
      valid: Boolean(d.is_valid),
      expires_at: never ? "" : new Date(d.expires_at! * 1000).toISOString().slice(0, 10),
      never,
      scopes: d.scopes || [],
      app: d.application || "",
    };
  } catch {
    return null; // some tokens can't inspect themselves; not worth failing the save over
  }
}

/* Keeping the connection alive without anyone remembering to. Meta will swap a valid token for
   a fresh 60-day one, but only while the current one still works — so Circuit does the swap
   well before the end rather than after it. The app id and secret are pasted once by the owner
   and stay on this Mac beside the token; Circuit never sends them anywhere except to Meta. */
export function renewalCredentials() {
  const id = getSetting("meta_app_id") || "";
  const secret = getSetting("meta_app_secret") || "";
  return id && secret ? { id, secret } : null;
}

export function autoRenewDue(daysBefore = 10) {
  if (!getMetaToken() || !renewalCredentials()) return false;
  const until = getSetting("meta_token_until");
  if (!until) return true; // unknown expiry: a short-lived token, worth swapping now
  return new Date(until).getTime() - Date.now() < daysBefore * 86400000;
}

/* Swaps the stored token for a longer-lived one and records the new expiry. */
export async function renewStoredToken() {
  const creds = renewalCredentials();
  if (!creds) throw new Error("Save the app id and secret first");
  const r = await extendToken(creds.id, creds.secret);
  setSetting("meta_token", r.token);
  setSetting("meta_token_until", new Date(Date.now() + r.days * 86400000).toISOString().slice(0, 10));
  const info = await tokenInfo(r.token);
  if (info) {
    setSetting("meta_token_scopes", info.scopes.join(","));
    if (!info.never && info.expires_at) setSetting("meta_token_until", info.expires_at);
  }
  return { days: r.days, until: getSetting("meta_token_until") };
}

/* Explorer tokens die in about an hour. With the app's own id and secret, Meta swaps one for a
   long-lived token (about 60 days), which is what keeps the automatic sync alive. */
export async function extendToken(appId: string, appSecret: string) {
  const token = getMetaToken();
  if (!token) throw new Error("Save your Meta token first");
  const body = (await callMeta("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId.trim(),
    client_secret: appSecret.trim(),
    fb_exchange_token: token,
  }, token)) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Meta didn't return a longer-lived token");
  const days = Math.round((body.expires_in || 5184000) / 86400);
  return { token: body.access_token, days };
}
