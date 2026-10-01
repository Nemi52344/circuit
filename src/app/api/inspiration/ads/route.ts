import { handle, ok, bad, readJson } from "@/lib/http";
import { searchAds, getMetaToken, type AdSearch } from "@/lib/meta";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = handle(async () => ok({ connected: Boolean(getMetaToken()) }));

export const POST = handle(async (req) => {
  const b = await readJson<AdSearch>(req);
  try {
    return ok(await searchAds(b));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "needs_meta_token") return bad("needs_meta_token: connect a Meta access token in Settings to search the Ad Library.", 428);
    return bad(msg, 502);
  }
});
