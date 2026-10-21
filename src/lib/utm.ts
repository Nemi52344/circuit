/* Tagging a link so the website can say where somebody came from.

   The convention is fixed on purpose. Hand-typed UTM tags drift — instagram, Instagram, ig,
   insta — and every spelling becomes its own row in the analytics, which is how a campaign
   ends up looking like four small ones. Here the source follows from the platform the post
   goes out on, and nobody gets to type it. */

/* What each platform calls itself in analytics. Lower case, no spaces, because that is what
   every analytics tool groups on. */
const SOURCE: Record<string, string> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  pinterest: "pinterest",
  youtube: "youtube",
  threads: "threads",
  whatsapp: "whatsapp",
};

export const sourceFor = (platform: string): string => {
  const k = (platform || "").trim().toLowerCase();
  return SOURCE[k] || k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "social";
};

/* A campaign nobody set: the month the post goes out in. It is a defensible default — a month
   is how this calendar is planned — and it beats an empty tag, which analytics drops silently
   rather than warning about. */
export const defaultCampaign = (scheduledAt: string): string => {
  const d = new Date(scheduledAt);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const slug = (s: string, max = 40): string =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max);

export type Taggable = {
  platform: string; scheduled_at: string;
  link_url?: string; utm_campaign?: string; utm_content?: string;
};

/* The tagged link, or an empty string when there is no destination to tag.

   Existing query parameters on the destination are kept: a link to a product page with its own
   ?colour=black is still that page, and dropping it would send people somewhere else. A utm_
   parameter already on the link loses to the one built here, because the post is the thing
   that knows where it is being published. */
export function taggedLink(p: Taggable): string {
  const raw = (p.link_url || "").trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  u.searchParams.set("utm_source", sourceFor(p.platform));
  u.searchParams.set("utm_medium", "social");
  const campaign = slug(p.utm_campaign || "") || defaultCampaign(p.scheduled_at);
  if (campaign) u.searchParams.set("utm_campaign", campaign);
  const content = slug(p.utm_content || "");
  if (content) u.searchParams.set("utm_content", content);
  return u.toString();
}

/* Why a link could not be tagged, in words rather than by returning nothing twice over. */
export function linkFault(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!u.hostname.includes(".")) return "That does not look like a web address";
    return "";
  } catch {
    return "That is not a web address Circuit can tag";
  }
}
