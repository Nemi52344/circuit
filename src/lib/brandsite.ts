import { getDb, getSetting, setSetting, newId, now } from "@/lib/db";
import { fetchUrl, decode, stripTags } from "@/lib/sources";

/* Step one of "world → audience → conversation → idea → content": read the brand's own website
   so Claude can say what the brand sells, who buys it and what problems it solves. */

export type SitePage = { url: string; title: string; description: string; headings: string[]; text: string };
export type SiteCrawl = { url: string; crawled_at: string; pages: SitePage[]; errors: string[] };
export type BrandProfile = {
  sells: string; buyers: string; problem: string;
  cares: string[]; misunderstands: string[]; complains: string[]; competitors_talk: string[];
  competitors: string[]; keywords: string[]; facts: { fact: string; source: string }[];
  content_opportunities: string[]; sources: { title: string; url: string }[]; analysed_at: string;
};

const PRIORITY = /about|product|bike|motorcycle|scooter|model|challenger|spec|feature|price|pricing|faq|service|warranty|dealer|store|contact|story|why|compare|battery|charging|blog/i;
const SKIP = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mov)$|\/(cart|checkout|account|login|signin|register|wp-admin|privacy|terms|cookie)/i;

const tagText = (html: string, tag: string) => Array.from(html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))).map((m) => stripTags(m[1])).filter(Boolean);
function meta(html: string, name: string) {
  const m = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"));
  return m ? decode((m[0].match(/content=["']([^"']*)["']/i) || [])[1] || "") : "";
}

function readPage(url: string, html: string): SitePage {
  const clean = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ");
  const headings = [...tagText(clean, "h1"), ...tagText(clean, "h2"), ...tagText(clean, "h3")].filter((h) => h.length < 140).slice(0, 30);
  const paras = [...tagText(clean, "p"), ...tagText(clean, "li")].filter((p) => p.length > 25);
  const text = Array.from(new Set(paras)).join("\n").slice(0, 5000);
  return { url, title: tagText(clean, "title")[0] || "", description: meta(html, "description") || meta(html, "og:description"), headings, text };
}

export async function crawlSite(input: string, maxPages = 8): Promise<SiteCrawl> {
  const start = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  const errors: string[] = [];
  const pages: SitePage[] = [];
  const seen = new Set<string>();
  const queue: string[] = [start.toString()];
  let host = start.hostname.replace(/^www\./, "");
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!;
    const norm = url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    try {
      const r = await fetchUrl(url, { maxBytes: 4_000_000, timeoutMs: 15000 });
      if (!r.ok) { errors.push(`${url}: HTTP ${r.status}`); continue; }
      if (!/html/i.test(r.contentType)) continue;
      if (!pages.length) host = new URL(r.finalUrl).hostname.replace(/^www\./, "");
      const html = r.buffer.toString("utf8");
      const page = readPage(r.finalUrl, html);
      // the same page often answers at two addresses (/challenger and /challenger.php)
      const sig = `${page.title}|${page.text.slice(0, 400)}`;
      if ((page.text || page.headings.length) && !pages.some((x) => `${x.title}|${x.text.slice(0, 400)}` === sig)) pages.push(page);
      // same-site links, the pages that explain the product first
      const links = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)).map((m) => { try { return new URL(decode(m[1]), r.finalUrl); } catch { return null; } })
        .filter((u): u is URL => Boolean(u && /^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, "") === host && !SKIP.test(u.pathname)))
        .map((u) => u.toString().replace(/#.*$/, ""));
      const fresh = Array.from(new Set(links)).filter((l) => !seen.has(l.replace(/[#?].*$/, "").replace(/\/$/, "")));
      queue.push(...fresh.filter((l) => PRIORITY.test(l)), ...fresh.filter((l) => !PRIORITY.test(l)).slice(0, 10));
    } catch (e) {
      errors.push(`${url}: ${(e as Error).message}`);
    }
  }
  if (!pages.length && !errors.length) errors.push("No readable text found. The site may build its pages with JavaScript only.");
  return { url: start.toString(), crawled_at: now(), pages, errors };
}

export function getSiteCrawl(): SiteCrawl | null {
  try { return JSON.parse(getSetting("brand_site") || "null"); } catch { return null; }
}
export function getBrandProfile(): BrandProfile | null {
  try { return JSON.parse(getSetting("brand_profile") || "null"); } catch { return null; }
}

/* Reads the site now, then queues Claude to write the brand profile from it (plus web search). */
export async function startBrandResearch(website: string) {
  const crawl = await crawlSite(website);
  setSetting("brand_site", JSON.stringify(crawl));
  const db = getDb();
  db.prepare("DELETE FROM research_jobs WHERE kind = 'brand' AND status = 'queued'").run();
  const id = newId();
  db.prepare("INSERT INTO research_jobs (id, slot_id, kind, status, payload, created_at, updated_at) VALUES (?, '', 'brand', 'queued', ?, ?, ?)")
    .run(id, JSON.stringify({ website: crawl.url }), now(), now());
  return { job_id: id, pages: crawl.pages.length, errors: crawl.errors };
}

export function brandJob() {
  return getDb().prepare("SELECT id, status, error, created_at, updated_at FROM research_jobs WHERE kind = 'brand' ORDER BY created_at DESC LIMIT 1").get() as
    { id: string; status: string; error: string; created_at: string; updated_at: string } | undefined;
}
