import { fetchUrl } from "@/lib/sources";

/* Pictures you are allowed to use, searched by topic.

   Google's own image search cannot be queried by a program without a paid key, and scraping it
   would break their terms and give pictures of unknown licence anyway. So Circuit searches the
   open libraries Google Images itself indexes — Openverse (Flickr, museums, Wikimedia and more,
   every result under a Creative Commons or public-domain licence) and Wikimedia Commons — and
   keeps the licence and the person to credit with every picture. The Inspiration screen also
   links out to Google Images with its "usage rights" filter for anything found by hand. */

export type FreeImage = {
  key: string; title: string; thumb: string; alt_thumb: string; full: string; page: string;
  source: string; creator: string; licence: string; width: number; height: number;
  reuse: "free" | "credit" | "check";
};

/* Wikimedia serves originals at full size — some are 40 MB — but will resize on request,
   so a grid asks for 500px wide instead of the whole thing. */
function small(url: string, px = 500) {
  // some come with tracking parameters on the end, which would break the match
  const clean = url.split("?")[0];
  const m = clean.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/([^/]+)\/([0-9a-f])\/([0-9a-f]{2})\/(.+\.(?:jpe?g|png))$/i);
  if (!m) return url;
  return `https://upload.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${px}px-${m[4]}`;
}

const UA = "Circuit/1.0 (local marketing workspace; contact: the owner of this install)";

/* CC0 and public domain need nothing; BY and BY-SA need a credit line; anything with NC or ND
   is not safe for a brand post, so it is marked to check rather than quietly offered. */
function licenceKind(licence: string): FreeImage["reuse"] {
  const l = licence.toLowerCase();
  if (/(^|\b)(cc0|pdm|public domain)/.test(l)) return "free";
  if (/nc|nd|sampling/.test(l)) return "check";
  if (/by/.test(l)) return "credit";
  return "check";
}

async function openverse(query: string, limit: number): Promise<FreeImage[]> {
  // only pictures a brand may actually use: commercial use allowed and changes allowed, so
  // nothing NonCommercial or NoDerivatives is offered in the first place.
  // Anonymous requests may not ask for more than 20 at a time.
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${Math.min(limit, 20)}`
    + "&license_type=commercial,modification&mature=false";
  const r = await fetchUrl(url, { ua: UA, accept: "application/json", maxBytes: 3_000_000, timeoutMs: 15000 });
  if (!r.ok) throw new Error(`Openverse HTTP ${r.status}`);
  const body = JSON.parse(r.buffer.toString("utf8")) as {
    results?: { id: string; title?: string; url?: string; thumbnail?: string; foreign_landing_url?: string; source?: string; creator?: string; license?: string; license_version?: string; width?: number; height?: number }[];
  };
  return (body.results || []).filter((x) => x.url).map((x) => {
    const licence = `${(x.license || "").toUpperCase()}${x.license_version ? ` ${x.license_version}` : ""}`.trim();
    return {
      key: `ov:${x.id}`,
      title: (x.title || "Untitled").slice(0, 120),
      // Openverse's own thumbnail service answers 424 often enough to look broken, so the
      // picture's real address is used, with their thumbnail kept only as a fallback
      thumb: small(x.url!),
      alt_thumb: x.thumbnail || "",
      full: x.url!,
      page: x.foreign_landing_url || x.url!,
      source: x.source || "Openverse",
      creator: x.creator || "",
      licence: licence || "Unknown",
      width: x.width || 0,
      height: x.height || 0,
      reuse: licenceKind(licence),
    };
  });
}

async function wikimedia(query: string, limit: number): Promise<FreeImage[]> {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6"
    + `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=400`;
  const r = await fetchUrl(url, { ua: UA, accept: "application/json", maxBytes: 3_000_000, timeoutMs: 15000 });
  if (!r.ok) throw new Error(`Wikimedia HTTP ${r.status}`);
  const body = JSON.parse(r.buffer.toString("utf8")) as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; width?: number; height?: number; extmetadata?: Record<string, { value?: string }> }[] }> };
  };
  const pages = Object.values(body.query?.pages || {});
  return pages.flatMap((p) => {
    const info = p.imageinfo?.[0];
    if (!info?.url || !/\.(jpe?g|png|webp)$/i.test(info.url)) return [];
    const meta = info.extmetadata || {};
    const licence = (meta.LicenseShortName?.value || meta.License?.value || "").replace(/<[^>]+>/g, "").trim();
    return [{
      key: `wm:${p.title}`,
      title: (p.title || "").replace(/^File:/, "").replace(/\.[^.]+$/, "").slice(0, 120),
      thumb: info.thumburl || small(info.url),
      alt_thumb: "",
      full: info.url,
      page: info.descriptionurl || info.url,
      source: "Wikimedia Commons",
      creator: (meta.Artist?.value || "").replace(/<[^>]+>/g, "").trim().slice(0, 80),
      licence: licence || "See the file page",
      width: info.width || 0,
      height: info.height || 0,
      reuse: licenceKind(licence),
    }];
  });
}

/* Both libraries at once, safest licences first, biggest pictures first within that.
   Anything NonCommercial or NoDerivatives is left out: a brand post is commercial use. */
export async function searchFreeImages(query: string, limit = 24): Promise<{ query: string; images: FreeImage[]; errors: string[]; google: string }> {
  const q = query.trim();
  const errors: string[] = [];
  if (!q) return { query: q, images: [], errors: ["Type what the picture should show"], google: "" };
  const safe = async (label: string, fn: () => Promise<FreeImage[]>) => {
    try { return await fn(); } catch (e) { errors.push(`${label}: ${(e as Error).message}`); return []; }
  };
  const [ov, wm] = await Promise.all([
    safe("Openverse", () => openverse(q, limit)),
    safe("Wikimedia", () => wikimedia(q, Math.round(limit / 2))),
  ]);
  // a long phrase often matches nothing; fall back to its first few words rather than
  // showing an empty grid
  let pool = [...ov, ...wm];
  const words = q.split(/\s+/);
  if (!pool.length && words.length > 2) {
    const shorter = words.slice(0, 2).join(" ");
    const [ov2, wm2] = await Promise.all([
      safe("Openverse", () => openverse(shorter, limit)),
      safe("Wikimedia", () => wikimedia(shorter, Math.round(limit / 2))),
    ]);
    pool = [...ov2, ...wm2];
  }
  const rank = { free: 0, credit: 1, check: 2 };
  const images = pool
    .filter((x, i, all) => all.findIndex((y) => y.full === x.full) === i)
    .sort((a, b) => rank[a.reuse] - rank[b.reuse] || b.width * b.height - a.width * a.height)
    .slice(0, limit);
  // Google's own image search, already filtered to pictures marked for reuse
  const google = `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch&tbs=il:cl`;
  return { query: q, images, errors, google };
}
