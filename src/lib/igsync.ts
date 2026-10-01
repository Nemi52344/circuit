import { getSetting, setSetting } from "@/lib/db";
import { igCompetitorPosts, getMetaToken } from "@/lib/meta";
import { getCompetitors, importItems } from "@/lib/sources";

/* Keeps the last week of competitors' Instagram posts in Inspiration without anyone pressing a
   button: every few hours the worker calls this, and only posts that aren't saved yet come in. */

export type IgSync = {
  at: string; days: number; saved: number; already: number;
  accounts: { competitor: string; handle: string; saved: number; recent: number; error?: string }[];
  errors: string[];
};

export const igConnected = () => Boolean(getMetaToken() && getSetting("ig_user_id"));
export function lastIgSync(): IgSync | null {
  try { return JSON.parse(getSetting("ig_last_sync") || "null"); } catch { return null; }
}

export async function syncCompetitorInstagram(days = 7): Promise<IgSync> {
  if (!igConnected()) throw new Error("Connect Instagram in Settings first");
  const since = Date.now() - days * 86400000;
  const out: IgSync = { at: new Date().toISOString(), days, saved: 0, already: 0, accounts: [], errors: [] };
  for (const c of getCompetitors().filter((x) => x.instagram)) {
    try {
      const acc = await igCompetitorPosts(c.instagram, 25);
      const recent = acc.posts.filter((p) => p.media_url && (!p.timestamp || new Date(p.timestamp).getTime() >= since));
      const r = recent.length
        ? await importItems(recent.map((p) => ({
            origin: `ig:${p.permalink}`,
            title: (p.caption || `${c.name} post`).replace(/\s+/g, " ").slice(0, 90),
            image: p.media_url,
            link: p.permalink,
            source: "Instagram",
            competitor: c.name,
            format: p.type,
            notes: `${p.likes} likes · ${p.comments} comments${p.timestamp ? ` · posted ${p.timestamp.slice(0, 10)}` : ""}${p.standout ? " · doing well for this account" : ""}`,
          })))
        : { created: [], skipped: [], errors: [] };
      out.saved += r.created.length;
      out.already += r.skipped.length;
      out.accounts.push({ competitor: c.name, handle: c.instagram, saved: r.created.length, recent: recent.length });
      for (const e of r.errors) out.errors.push(`${c.name}: ${e.error}`);
    } catch (e) {
      const msg = (e as Error).message;
      out.accounts.push({ competitor: c.name, handle: c.instagram, saved: 0, recent: 0, error: msg });
      out.errors.push(`${c.name}: ${msg}`);
    }
  }
  setSetting("ig_last_sync", JSON.stringify(out));
  return out;
}

/* True when it's time to look again: every 6 hours, or every hour after a failure. */
export function igSyncDue(hours = 6) {
  if (!igConnected()) return false;
  const last = lastIgSync();
  if (!last) return true;
  const gap = last.errors.length && !last.saved ? 1 : hours;
  return Date.now() - new Date(last.at).getTime() > gap * 3600000;
}
