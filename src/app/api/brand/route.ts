import { handle, ok, bad, readJson } from "@/lib/http";
import { setSetting } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import { getBrandProfile, getSiteCrawl, startBrandResearch, brandJob } from "@/lib/brandsite";

import { startWorker, kickWorker } from "@/lib/worker";

export const runtime = "nodejs";
// queuing work wakes the automatic worker
startWorker();
export const maxDuration = 120;

export const GET = handle(async () => {
  const site = getSiteCrawl();
  return ok({
    website: getBrand().website,
    profile: getBrandProfile(),
    site: site ? { url: site.url, crawled_at: site.crawled_at, pages: site.pages.map((p) => ({ url: p.url, title: p.title })), errors: site.errors } : null,
    job: brandJob() || null,
  });
});

/* Save the website (optional) and read it now; Claude writes the profile from what was read. */
export const POST = handle(async (req) => {
  const b = await readJson<{ website?: string }>(req);
  const website = (b.website ?? getBrand().website ?? "").trim();
  if (!website) return bad("Add your website first");
  try { new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`); } catch { return bad("That doesn't look like a web address"); }
  setSetting("brand", JSON.stringify({ ...getBrand(), website }));
  try {
    return ok(await startBrandResearch(website), 201);
  } catch (e) {
    return bad((e as Error).message);
  }
});
