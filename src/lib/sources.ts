import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, saveFileBuffer, newId, now, DATA_DIR } from "@/lib/db";

/* Inspiration sources: public, read-only fetches with no login, no scraping of private accounts,
   and no browser automation. Everything fetched is stored as a reference-only asset with its origin. */

export type SourceKind = "pinterest" | "instagram" | "website" | "reddit";
export type SourceItem = {
  key: string;
  title: string;
  image: string | null;
  link: string;
  source: string;
  competitor: string;
  format: string;
  notes: string;
  meta?: Record<string, string | number>;
};
export type ImportItem = {
  title: string;
  image?: string | null;
  path?: string;
  link: string;
  source: string;
  competitor: string;
  format: string;
  notes: string;
  rights?: string;
  /* a stable id for "already saved", when the image URL itself changes on every fetch */
  origin?: string;
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FEED_UA = "Circuit/1.0 (local marketing workspace; contact info@boommotors.com)";
export const DEFAULT_RIGHTS = "Third-party. Reference only, do not publish.";
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

/* ---------- fetch helpers ---------- */

function assertPublicHttp(u: URL) {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links are fetched");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" || h.endsWith(".local") || h === "0.0.0.0" || h === "::1" || /^127\./.test(h) || /^10\./.test(h) ||
    /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
  ) throw new Error("Local and private addresses are not fetched");
}

export async function fetchUrl(url: string, opts: { ua?: string; accept?: string; maxBytes?: number; timeoutMs?: number } = {}) {
  const u = new URL(url);
  assertPublicHttp(u);
  const max = opts.maxBytes ?? 3_000_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(u, {
      headers: {
        "user-agent": opts.ua ?? BROWSER_UA,
        accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > max) throw new Error(`Response too large (${Math.round(declared / 1e6)} MB)`);
    const ab = await res.arrayBuffer();
    if (ab.byteLength > max) throw new Error(`Response too large (${Math.round(ab.byteLength / 1e6)} MB)`);
    return { status: res.status, ok: res.ok, contentType: res.headers.get("content-type") || "", buffer: Buffer.from(ab), finalUrl: res.url || u.toString() };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Timed out fetching ${u.hostname}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
export const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tagText = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
const attr = (tag: string, name: string) => decode((tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i")) || tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i")) || [])[1] || "");
function metaContent(html: string, prop: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(":", "\\:")}["'][^>]*>`, "i");
  const m = html.match(re);
  if (!m) return "";
  return attr(m[0], "content");
}
function dedupe(items: SourceItem[]) {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}
const lines = (input: string, max: number) => Array.from(new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))).slice(0, max);
const withProto = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

/* ---------- Pinterest: pin pages (og:image) and profile / board RSS ---------- */

export async function fetchPinterest(input: string): Promise<{ items: SourceItem[]; note: string }> {
  const items: SourceItem[] = [];
  const notes: string[] = [];
  for (const raw of lines(input, 8)) {
    try {
      let url = withProto(raw);
      let u = new URL(url);
      if (u.hostname === "pin.it") {
        const r = await fetchUrl(url, { maxBytes: 4_000_000 });
        u = new URL(r.finalUrl);
        url = u.toString();
      }
      if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) { notes.push(`${raw}: not a Pinterest link`); continue; }
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "pin" && parts[1]) {
        const r = await fetchUrl(url, { maxBytes: 6_000_000 });
        const html = r.buffer.toString("utf8");
        const og = metaContent(html, "og:image");
        if (!og) { notes.push(`${raw}: Pinterest did not return an image for this pin (HTTP ${r.status})`); continue; }
        const id = parts[1].replace(/\D/g, "") || parts[1];
        items.push({
          key: `pin:${id}`, title: (metaContent(html, "og:title") || `Pin ${id}`).slice(0, 140), image: og,
          link: `https://www.pinterest.com/pin/${id}/`, source: "Pinterest", competitor: "", format: "Pin",
          notes: metaContent(html, "og:description").slice(0, 300),
        });
      } else if (parts.length && parts[0] !== "search" && parts[0] !== "ideas") {
        const user = parts[0];
        const board = parts[1] && !["pins", "_saved", "_created", "boards"].includes(parts[1]) ? parts[1] : "";
        const boardFeed = `https://www.pinterest.com/${user}/${board}.rss`;
        const profileFeed = `https://www.pinterest.com/${user}/feed.rss`;
        let r = await fetchUrl(board ? boardFeed : profileFeed, { accept: "application/rss+xml, application/xml, text/xml, */*" });
        let usedProfile = !board;
        if (board && !r.ok) {
          // A secret, renamed or empty board answers 404. The profile feed still carries the person's latest pins.
          r = await fetchUrl(profileFeed, { accept: "application/rss+xml, application/xml, text/xml, */*" });
          usedProfile = true;
          if (r.ok) notes.push(`${raw}: Pinterest has no public feed for the board "${board}" (secret boards have none). Showing ${user}'s latest pins instead.`);
        }
        if (!r.ok) { notes.push(`${raw}: Pinterest returned HTTP ${r.status}. Check the profile or board name.`); continue; }
        const xml = r.buffer.toString("utf8");
        let n = 0;
        for (const it of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
          const title = decode(tagText(it, "title")).trim();
          const link = decode(tagText(it, "link")).trim();
          const desc = decode(tagText(it, "description"));
          const img = (desc.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
          const pinId = (link.match(/\/pin\/(\d+)/) || [])[1] || link;
          items.push({
            key: `pin:${pinId}`, title: (title || `Pin ${pinId}`).slice(0, 140), image: img ? img.replace("/236x/", "/736x/") : null, link,
            source: "Pinterest", competitor: user, format: "Pin", notes: stripTags(desc).slice(0, 300), meta: { board: usedProfile ? "profile feed" : board },
          });
          n += 1;
        }
        if (!n) notes.push(`${raw}: the feed had no pins`);
      } else {
        notes.push(`${raw}: Pinterest search pages are built in the browser and cannot be fetched. Paste a pin, board or profile link.`);
      }
    } catch (e) {
      notes.push(`${raw}: ${(e as Error).message}`);
    }
  }
  return { items: dedupe(items), note: notes.join(" · ") };
}

/* ---------- Instagram: public embed endpoint when it answers, otherwise link-only ---------- */

export async function fetchInstagram(input: string): Promise<{ items: SourceItem[]; note: string }> {
  const items: SourceItem[] = [];
  let blocked = 0;
  for (const raw of lines(input, 12)) {
    const m = raw.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/) || raw.match(/^([A-Za-z0-9_-]{8,14})$/);
    if (!m) continue;
    const code = m[1];
    const link = `https://www.instagram.com/p/${code}/`;
    const account = (raw.match(/instagram\.com\/([A-Za-z0-9_.]+)\/(?:reel|reels|p|tv)\//) || [])[1] || "";
    let image: string | null = null;
    let caption = "";
    let user = account;
    try {
      const r = await fetchUrl(`${link}embed/captioned/`, { maxBytes: 2_000_000, timeoutMs: 12000 });
      const html = r.buffer.toString("utf8");
      const img = html.match(/<img[^>]+class="EmbeddedMediaImage"[^>]*>/);
      if (img) image = attr(img[0], "src") || null;
      const cap = html.match(/<div class="Caption">([\s\S]*?)<div class="CaptionComments">/);
      if (cap) caption = stripTags(cap[1]).slice(0, 300);
      const u = html.match(/class="UsernameText">([^<]+)</);
      if (u) user = decode(u[1]);
    } catch {
      // treated the same as a blocked fetch below
    }
    if (!image) blocked += 1;
    items.push({
      key: `ig:${code}`, title: caption ? caption.slice(0, 90) : `Instagram post ${code}`, image, link, source: "Instagram",
      competitor: user, format: raw.includes("/reel") ? "Reel" : "Post", notes: caption, meta: { code },
    });
  }
  const note = blocked
    ? `${blocked} of ${items.length} link${items.length > 1 ? "s" : ""}: Instagram does not serve post images to a logged-out fetch. Add the image by hand from the post (save or screenshot); the link, account and date are recorded either way. Trending and account feeds need the Meta Graph API after gate G1.`
    : "";
  return { items: dedupe(items), note };
}

/* ---------- Competitor websites: og:image plus every content image on the page ---------- */

const SKIP_IMG = /(logo|icon|sprite|favicon|pixel|badge|arrow|spinner|loader|placeholder|blank|close|menu|hamburger|social|flag|avatar|tick|check|star|whatsapp|facebook|instagram|linkedin|youtube|twitter|play_|_play|cursor|dot\.|line\.)/i;

function pickSrcset(srcset: string) {
  const parts = srcset.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  const last = parts[parts.length - 1].split(/\s+/)[0];
  return last;
}
function brandFromTitle(title: string, host: string) {
  const seg = title.split(/\s[|–—-]\s|:\s/).map((s) => s.trim()).filter(Boolean);
  const first = seg[0] || "";
  return first && first.length <= 40 ? first : host;
}

export async function fetchWebsite(input: string): Promise<{ items: SourceItem[]; note: string }> {
  const items: SourceItem[] = [];
  const notes: string[] = [];
  for (const raw of lines(input, 5)) {
    try {
      const url = withProto(raw);
      const r = await fetchUrl(url, { maxBytes: 4_000_000 });
      if (!r.ok) {
        notes.push(`${raw}: HTTP ${r.status}${r.status === 403 || r.status === 503 ? " (this site blocks automated fetches; save screenshots or use the folder import instead)" : ""}`);
        continue;
      }
      const html = r.buffer.toString("utf8");
      const base = r.finalUrl;
      const host = new URL(base).hostname.replace(/^www\./, "");
      const pageTitle = stripTags(tagText(html, "title")).slice(0, 120);
      const competitor = brandFromTitle(pageTitle, host);
      const found: { src: string; alt: string; w: number; h: number }[] = [];
      for (const p of ["og:image", "og:image:secure_url", "twitter:image"]) {
        const v = metaContent(html, p);
        if (v) found.push({ src: v, alt: pageTitle, w: 0, h: 0 });
      }
      for (const m of html.match(/<img\b[^>]*>/gi) || []) {
        const src = attr(m, "src") || attr(m, "data-src") || attr(m, "data-lazy-src") || attr(m, "data-original") || pickSrcset(attr(m, "srcset") || attr(m, "data-srcset"));
        if (!src) continue;
        found.push({ src, alt: attr(m, "alt"), w: Number(attr(m, "width")) || 0, h: Number(attr(m, "height")) || 0 });
      }
      for (const m of html.match(/<source\b[^>]*>/gi) || []) {
        const src = pickSrcset(attr(m, "srcset") || attr(m, "data-srcset"));
        if (src) found.push({ src, alt: "", w: 0, h: 0 });
      }
      let n = 0;
      for (const f of found) {
        if (f.src.startsWith("data:") || f.src.includes("${")) continue;
        if (f.w && f.w < 120 && f.h && f.h < 120) continue;
        let abs: URL;
        try { abs = new URL(f.src, base); } catch { continue; }
        if (abs.protocol !== "https:" && abs.protocol !== "http:") continue;
        if (/\.(svg|ico)$/i.test(abs.pathname)) continue;
        if (SKIP_IMG.test(abs.pathname)) continue;
        const key = `web:${abs.toString()}`;
        if (items.some((i) => i.key === key)) continue;
        items.push({
          key, title: (f.alt || pageTitle || host).slice(0, 120), image: abs.toString(), link: base, source: "Website",
          competitor, format: "Web image", notes: "", meta: { page: base },
        });
        n += 1;
        if (n >= 80) break;
      }
      if (!n) notes.push(`${raw}: no content images found on that page`);
    } catch (e) {
      notes.push(`${raw}: ${(e as Error).message}`);
    }
  }
  return { items: dedupe(items), note: notes.join(" · ") };
}

/* ---------- Reddit: public Atom feeds (subreddit top, in-subreddit search, global search) ---------- */

const redditCache = new Map<string, { at: number; items: SourceItem[] }>();

export function parseRedditInput(input: string) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  let sub = "";
  const rest: string[] = [];
  for (const t of tokens) {
    const m = t.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/) || t.match(/^\/?r\/([A-Za-z0-9_]+)\/?$/);
    if (m && !sub) sub = m[1];
    else rest.push(t);
  }
  if (!sub && rest.length === 1 && /^[A-Za-z0-9_]{3,21}$/.test(rest[0])) sub = rest.shift() as string;
  return { sub, q: rest.join(" ").trim() };
}

export async function fetchReddit(input: string): Promise<{ items: SourceItem[]; note: string }> {
  const { sub, q } = parseRedditInput(input);
  if (!sub && !q) throw new Error("Give a subreddit (r/electricvehicles), a keyword, or both");
  const enc = encodeURIComponent(q);
  const feed = sub && q
    ? `https://www.reddit.com/r/${sub}/search.rss?q=${enc}&restrict_sr=1&sort=top&t=year&limit=25`
    : sub
      ? `https://www.reddit.com/r/${sub}/top.rss?t=week&limit=25`
      : `https://www.reddit.com/search.rss?q=${enc}&sort=top&t=month&limit=25`;
  const cached = redditCache.get(feed);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return { items: cached.items, note: "From cache (Reddit allows only a few feed reads per minute)." };
  const r = await fetchUrl(feed, { ua: FEED_UA, accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8" });
  if (r.status === 429) throw new Error("Reddit rate-limited this request. Wait a minute and try again.");
  if (!r.ok) throw new Error(`Reddit returned HTTP ${r.status} for ${sub ? `r/${sub}` : "search"}`);
  const xml = r.buffer.toString("utf8");
  const items: SourceItem[] = [];
  for (const e of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const title = decode(tagText(e, "title")).trim();
    const link = attr(e.match(/<link\b[^>]*>/) ?.[0] || "", "href");
    const author = decode(tagText(e, "name")).trim();
    const updated = tagText(e, "updated").trim();
    const cat = attr(e.match(/<category\b[^>]*>/)?.[0] || "", "term") || sub;
    const content = decode(tagText(e, "content"));
    const linkHref = (content.match(/<a href="([^"]+)">\s*\[link\]/) || [])[1] || "";
    const text = stripTags(content).replace(/submitted by.*$/i, "").replace(/\[link\]|\[comments\]/g, "").trim();
    const image = /^https:\/\/i\.redd\.it\//.test(linkHref) || IMAGE_EXT.test(linkHref.split("?")[0]) ? linkHref : null;
    const id = (link.match(/comments\/([a-z0-9]+)/) || [])[1] || link;
    if (!title || !link) continue;
    items.push({
      key: `reddit:${id}`, title: title.slice(0, 140), image, link, source: "Reddit", competitor: cat ? `r/${cat}` : "Reddit",
      format: image ? "Image post" : "Idea", notes: [text.slice(0, 280), author].filter(Boolean).join(" · "),
      meta: { updated, external: linkHref && !image ? linkHref : "" },
    });
  }
  redditCache.set(feed, { at: Date.now(), items });
  return { items, note: items.length ? "" : "No posts came back. Try a different subreddit or keyword." };
}

/* ---------- Root folder: one subfolder per company, images inside ---------- */

export const DEFAULT_ROOT = path.join(DATA_DIR, "sources");
export function getSourcesRoot() {
  return getSetting("sources_root") || DEFAULT_ROOT;
}
export function ensureDefaultRoot() {
  if (fs.existsSync(DEFAULT_ROOT)) return;
  fs.mkdirSync(DEFAULT_ROOT, { recursive: true });
  for (const d of ["Ola Electric", "Ather", "TVS", "Bajaj", "Revolt", "Ultraviolette", "BNC Motors (own)"]) fs.mkdirSync(path.join(DEFAULT_ROOT, d), { recursive: true });
  fs.writeFileSync(
    path.join(DEFAULT_ROOT, "README.txt"),
    "Circuit inspiration root folder.\n\nOne subfolder per company. Drop images (jpg, png, webp, gif) inside.\nThe Inspiration screen lists every folder here; Import copies the images into data/uploads and records the folder name as the competitor.\nYou can point Circuit at a different root folder from the Inspiration screen.\n",
  );
}
export type FolderImage = { name: string; path: string; size: number; mtime: string; imported: boolean };
export type FolderEntry = { name: string; path: string; images: FolderImage[] };

function walkImages(dir: string, depth: number, out: { name: string; path: string; size: number; mtime: string }[]) {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 3) walkImages(p, depth + 1, out); continue; }
    if (!IMAGE_EXT.test(e.name)) continue;
    const st = fs.statSync(p);
    out.push({ name: e.name, path: p, size: st.size, mtime: st.mtime.toISOString() });
  }
}

export function listFolders(): { root: string; exists: boolean; isDefault: boolean; folders: FolderEntry[]; total: number; imported: number } {
  const root = getSourcesRoot();
  if (root === DEFAULT_ROOT) ensureDefaultRoot();
  const exists = fs.existsSync(root) && fs.statSync(root).isDirectory();
  const done = new Set(
    (getDb().prepare("SELECT origin FROM inspirations WHERE origin LIKE 'file://%'").all() as { origin: string }[]).map((r) => r.origin),
  );
  const folders: FolderEntry[] = [];
  let total = 0;
  let imported = 0;
  if (exists) {
    const loose: FolderImage[] = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(root, e.name);
      if (e.isDirectory()) {
        const imgs: { name: string; path: string; size: number; mtime: string }[] = [];
        walkImages(p, 1, imgs);
        const images = imgs.sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ ...i, imported: done.has(`file://${i.path}`) }));
        folders.push({ name: e.name, path: p, images });
        total += images.length;
        imported += images.filter((i) => i.imported).length;
      } else if (IMAGE_EXT.test(e.name)) {
        const st = fs.statSync(p);
        loose.push({ name: e.name, path: p, size: st.size, mtime: st.mtime.toISOString(), imported: done.has(`file://${p}`) });
      }
    }
    if (loose.length) {
      folders.unshift({ name: "(root)", path: root, images: loose });
      total += loose.length;
      imported += loose.filter((i) => i.imported).length;
    }
  }
  return { root, exists, isDefault: root === DEFAULT_ROOT, folders, total, imported };
}

export function localImagePath(p: string) {
  const root = path.resolve(getSourcesRoot());
  const abs = path.resolve(p);
  if (!(abs === root || abs.startsWith(root + path.sep))) throw new Error("That file is outside the inspiration root folder");
  if (!IMAGE_EXT.test(abs)) throw new Error("Not an image file");
  if (!fs.existsSync(abs)) throw new Error("File not found");
  return abs;
}
export function mimeFor(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" } as Record<string, string>)[ext] || "application/octet-stream";
}

/* ---------- Import: download or copy, store with provenance, skip what is already there ---------- */

export async function importItems(items: ImportItem[]) {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO inspirations (id, title, competitor, platform, format, source_url, notes, file_id, rights, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const exists = db.prepare("SELECT id FROM inspirations WHERE origin = ? LIMIT 1");
  const created: { id: string; title: string }[] = [];
  const skipped: string[] = [];
  const errors: { title: string; error: string }[] = [];
  for (const it of items.slice(0, 120)) {
    const origin = it.origin || (it.path ? `file://${path.resolve(it.path)}` : it.image || it.link);
    if (!origin) { errors.push({ title: it.title, error: "Nothing to import" }); continue; }
    if (exists.get(origin)) { skipped.push(it.title); continue; }
    try {
      let fileId: string | null = null;
      if (it.path) {
        const abs = localImagePath(it.path);
        const buf = fs.readFileSync(abs);
        fileId = saveFileBuffer(buf, path.basename(abs), mimeFor(abs), "inspiration").id;
      } else if (it.image) {
        const r = await fetchUrl(it.image, { accept: "image/avif,image/webp,image/*,*/*;q=0.8", maxBytes: 15_000_000, timeoutMs: 20000 });
        if (!r.ok) throw new Error(`image download failed (HTTP ${r.status})`);
        const ct = r.contentType.split(";")[0].trim();
        const mime = ct.startsWith("image/") ? ct : mimeFor(new URL(it.image).pathname);
        if (!mime.startsWith("image/")) throw new Error(`not an image (${ct || "unknown type"})`);
        const name = decodeURIComponent(path.basename(new URL(it.image).pathname)) || "image";
        fileId = saveFileBuffer(r.buffer, IMAGE_EXT.test(name) ? name : `${name}.${mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]}`, mime, "inspiration").id;
      } else if (!it.link) {
        throw new Error("no image and no link");
      }
      const id = newId();
      const title = (it.title || (it.path ? path.basename(it.path).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") : "Untitled")).slice(0, 160);
      insert.run(id, title, it.competitor || "", it.source || "", it.format || "", it.link || "", it.notes || "", fileId, it.rights || DEFAULT_RIGHTS, origin, now());
      created.push({ id, title });
    } catch (e) {
      errors.push({ title: it.title, error: (e as Error).message });
    }
  }
  return { created, skipped, errors };
}

/* ---------- Watchlist: sources the marketer checks by hand, one click to pull ---------- */

export type Watch = { id: string; kind: SourceKind; label: string; input: string };
const DEFAULT_WATCH: Omit<Watch, "id">[] = [
  { kind: "reddit", label: "r/electricvehicles", input: "r/electricvehicles" },
  { kind: "reddit", label: "r/ElectricScooters", input: "r/ElectricScooters" },
  { kind: "reddit", label: "r/IndianBikes", input: "r/IndianBikes" },
  { kind: "reddit", label: "r/motorcycles", input: "r/motorcycles" },
  { kind: "reddit", label: "r/marketing", input: "r/marketing" },
];
export function getWatchlist(): Watch[] {
  const raw = getSetting("inspiration_watch");
  if (raw) {
    try { return JSON.parse(raw) as Watch[]; } catch { /* fall through to defaults */ }
  }
  const seeded = DEFAULT_WATCH.map((w) => ({ id: newId(), ...w }));
  db_set("inspiration_watch", JSON.stringify(seeded));
  return seeded;
}
export function setWatchlist(list: Watch[]) {
  db_set("inspiration_watch", JSON.stringify(list));
}
function db_set(key: string, value: string) {
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/* ---------- Competitor registry: one card per company, each with its site, handles and folder ---------- */

export type Competitor = { id: string; name: string; website: string; instagram: string; pinterest: string; folder: string; notes: string };
const DEFAULT_COMPETITORS: Omit<Competitor, "id">[] = [
  { name: "Ola Electric", website: "https://www.olaelectric.com/", instagram: "olaelectric", pinterest: "", folder: "Ola Electric", notes: "" },
  { name: "Ather", website: "https://www.atherenergy.com/", instagram: "", pinterest: "", folder: "Ather", notes: "Site blocks automated fetches; use the folder or pasted posts." },
  { name: "TVS", website: "https://www.tvsmotor.com/", instagram: "", pinterest: "", folder: "TVS", notes: "" },
  { name: "Bajaj", website: "https://www.bajajauto.com/", instagram: "", pinterest: "", folder: "Bajaj", notes: "" },
  { name: "Revolt", website: "https://www.revoltmotors.com/", instagram: "", pinterest: "", folder: "Revolt", notes: "" },
  { name: "Ultraviolette", website: "https://www.ultraviolette.com/", instagram: "", pinterest: "", folder: "Ultraviolette", notes: "" },
];
export function getCompetitors(): Competitor[] {
  const raw = getSetting("competitors");
  if (raw) {
    try { return JSON.parse(raw) as Competitor[]; } catch { /* fall through to defaults */ }
  }
  const seeded = DEFAULT_COMPETITORS.map((c) => ({ id: newId(), ...c }));
  db_set("competitors", JSON.stringify(seeded));
  return seeded;
}
export function setCompetitors(list: Competitor[]) {
  db_set("competitors", JSON.stringify(list));
}
export function ensureCompetitorFolder(folder: string) {
  const root = getSourcesRoot();
  if (!folder || !fs.existsSync(root)) return;
  const safe = folder.replace(/[\/:]/g, "-").trim();
  if (!safe) return;
  try { fs.mkdirSync(path.join(root, safe), { recursive: true }); } catch { /* read-only root is fine */ }
}
