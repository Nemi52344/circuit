import { getDb, getSetting, setSetting } from "@/lib/db";
import { crawlSite, getSiteCrawl, type SiteCrawl } from "@/lib/brandsite";

/* Jobs that belong to the actual work, rather than to Circuit's housekeeping.

   The routines Circuit shipped with look after Circuit: back up, read competitors, sweep the
   intel. These two look after the work itself — is the website still saying the right thing,
   and what is due to go out — so a workflow can be about a real job rather than about the app. */

export type SiteChange = { kind: "added" | "gone" | "changed" | "broken"; url: string; was?: string; now?: string };

/* Reads the website again and says what moved since last time.

   It reports differences, never opinions: a page that appeared, one that stopped answering, a
   title or description that was edited. What is wrong with any of it is a judgement, and that
   belongs to a person looking at the list. */
export async function checkWebsite(): Promise<{ url: string; pages: number; changes: SiteChange[]; errors: string[]; first: boolean }> {
  const before = getSiteCrawl();
  const url = before?.url || getSetting("brand_website") || "https://bncmotors.in/";
  const fresh = await crawlSite(url, 10);
  const changes: SiteChange[] = [];

  if (before) {
    const was = new Map(before.pages.map((p) => [p.url, p]));
    const now = new Map(fresh.pages.map((p) => [p.url, p]));
    for (const [u, p] of now) {
      const old = was.get(u);
      if (!old) { changes.push({ kind: "added", url: u, now: p.title }); continue; }
      if (old.title !== p.title) changes.push({ kind: "changed", url: u, was: old.title, now: p.title });
      else if (old.description !== p.description) changes.push({ kind: "changed", url: u, was: old.description.slice(0, 90), now: p.description.slice(0, 90) });
    }
    for (const [u, p] of was) if (!now.has(u)) changes.push({ kind: "gone", url: u, was: p.title });
  }

  /* A page that would not load is not a failure of the check — it is the single most useful
     thing the check can tell you. A 404 on a page that used to work is precisely the correction
     this routine exists to find, so it goes in the list rather than into an error that marks the
     whole step red and hides the seven real findings underneath it. */
  for (const e of fresh.errors) {
    const at = e.indexOf(": ");
    changes.push({ kind: "broken", url: at > 0 ? e.slice(0, at) : e, now: at > 0 ? e.slice(at + 2) : "would not load" });
  }

  /* The new reading replaces the old one only once it is compared, so a crawl that half-failed
     cannot quietly become the baseline everything is measured against. */
  if (fresh.pages.length) setSetting("brand_site", JSON.stringify(fresh as SiteCrawl));
  return { url, pages: fresh.pages.length, changes, errors: fresh.errors, first: !before };
}

export type Due = { id: string; platform: string; when: string; caption: string; slot_id: string | null; late: boolean };

/* What is meant to go out and has not. Posting is a person's job — Circuit's part is making
   sure nothing is quietly missed. */
export function postsDue(withinDays = 2): { due: Due[]; late: number } {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT p.id, p.platform, p.scheduled_at, p.caption, p.slot_id
    FROM posts p
    WHERE p.status != 'posted' AND substr(p.scheduled_at, 1, 10) <= ?
    ORDER BY p.scheduled_at`).all(until) as { id: string; platform: string; scheduled_at: string; caption: string; slot_id: string | null }[];

  const due = rows.map((r) => ({
    id: r.id, platform: r.platform, when: r.scheduled_at,
    caption: (r.caption || "").slice(0, 80), slot_id: r.slot_id,
    late: r.scheduled_at.slice(0, 10) < today,
  }));
  return { due, late: due.filter((d) => d.late).length };
}
