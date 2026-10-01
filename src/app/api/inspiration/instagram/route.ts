import { handle, ok, bad, readJson } from "@/lib/http";
import { getSetting } from "@/lib/db";
import { igCompetitorPosts, getMetaToken, type IgAccount } from "@/lib/meta";
import { getCompetitors, importItems } from "@/lib/sources";
import { syncCompetitorInstagram, lastIgSync } from "@/lib/igsync";

export const runtime = "nodejs";
export const maxDuration = 120;

/* Competitors' recent Instagram posts, through Meta's official Business Discovery API.
   Posts doing at least twice that account's median engagement are flagged as standouts. */
export const GET = handle(async (req) => {
  if (!getMetaToken() || !getSetting("ig_user_id")) return bad("Connect Instagram in Settings first", 428);
  const u = new URL(req.url);
  const only = u.searchParams.get("handle");
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") || 8), 1), 25);
  const list = getCompetitors().filter((c) => c.instagram && (!only || c.instagram === only));
  if (!list.length) return bad("No competitor has an Instagram handle yet");
  const accounts: (IgAccount & { competitor: string })[] = [];
  const errors: string[] = [];
  for (const c of list) {
    try {
      const acc = await igCompetitorPosts(c.instagram, limit);
      accounts.push({ ...acc, competitor: c.name });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  return ok({ accounts, errors, last_sync: lastIgSync() });
});

/* Save chosen posts into Inspiration, with their engagement kept as the note.
   action "sync" saves everything the competitors posted in the last week. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; days?: number; posts?: { competitor?: string; caption?: string; permalink?: string; media_url?: string; likes?: number; comments?: number; type?: string; timestamp?: string }[] }>(req);
  if (b.action === "sync") {
    try {
      return ok(await syncCompetitorInstagram(Math.min(Math.max(Number(b.days) || 7, 1), 30)));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  const posts = (b.posts || []).filter((p) => p?.media_url);
  if (!posts.length) return bad("Nothing to save");
  const r = await importItems(posts.map((p) => ({
    key: `ig:${p.permalink}`,
    title: (p.caption || "Instagram post").replace(/\s+/g, " ").slice(0, 90),
    image: p.media_url!,
    link: p.permalink || "",
    source: "Instagram",
    competitor: p.competitor || "",
    format: p.type || "",
    notes: `${p.likes ?? 0} likes · ${p.comments ?? 0} comments${p.timestamp ? ` · posted ${p.timestamp.slice(0, 10)}` : ""}`,
  })));
  return ok(r, 201);
});
