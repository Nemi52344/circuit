import { handle, bad } from "@/lib/http";
import { fetchUrl } from "@/lib/sources";

export const runtime = "nodejs";

/* Preview proxy for fetched-but-not-yet-saved images whose CDN refuses hotlinking.
   Only used as a fallback when the browser cannot load the image directly. */
export const GET = handle(async (req) => {
  const url = new URL(req.url).searchParams.get("url") || "";
  if (!/^https?:\/\//i.test(url)) return bad("url required");
  try {
    const r = await fetchUrl(url, { accept: "image/avif,image/webp,image/*,*/*;q=0.8", maxBytes: 15_000_000, timeoutMs: 20000 });
    const ct = r.contentType.split(";")[0].trim();
    if (!r.ok || !ct.startsWith("image/")) return bad(`Not an image (HTTP ${r.status})`, 502);
    return new Response(r.buffer, { headers: { "content-type": ct, "content-length": String(r.buffer.length), "cache-control": "private, max-age=600" } });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
});
