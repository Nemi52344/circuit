import { handle, ok, bad, readJson } from "@/lib/http";
import { fetchPinterest, fetchInstagram, fetchWebsite, fetchReddit, type SourceKind } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 60;

const FETCHERS: Record<SourceKind, (input: string) => Promise<{ items: unknown[]; note: string }>> = {
  pinterest: fetchPinterest,
  instagram: fetchInstagram,
  website: fetchWebsite,
  reddit: fetchReddit,
};

export const POST = handle(async (req) => {
  const b = await readJson<{ kind?: string; input?: string }>(req);
  const kind = (b.kind || "") as SourceKind;
  const input = (b.input || "").trim();
  if (!FETCHERS[kind]) return bad("Unknown source. Use pinterest, instagram, website or reddit.");
  if (!input) return bad("Paste a link, a profile, a board or a subreddit first");
  try {
    return ok(await FETCHERS[kind](input));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
});
