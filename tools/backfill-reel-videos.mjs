/* Fetch the videos for reels that were saved as a cover frame only.

   Circuit used to ask Instagram for thumbnail_url and stop there, so every reel in Inspiration
   is a frozen first frame. The app now keeps the MP4 too, but only for things saved from here
   on — the CDN link a reel arrived with expired long ago.

   The post itself is still on Instagram, though, and Business Discovery hands back a fresh,
   working media_url every time it is asked. So this goes back for them: it matches saved rows
   to live posts by permalink, downloads the video, and files it beside the cover.

   The same thing sits behind the "Fetch the missing videos" button on Inspiration → Video.
   This exists for when you cannot get to that button — locked out, or you would rather watch
   it run in a terminal.

   Usage, from the project root, with Circuit NOT running (it holds the database open):
     node tools/backfill-reel-videos.mjs

   Reels average about 6 MB. It prints a running total so you can stop it if that is too much.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const API = "v21.0";
const MAX_VIDEO_BYTES = 60_000_000;
const DATA = path.join(process.cwd(), "data");
const UPLOADS = path.join(DATA, "uploads");

const db = new Database(path.join(DATA, "circuit.db"));
const setting = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || "";

const token = setting("meta_token");
const igUser = setting("ig_user_id");
if (!token || !igUser) {
  console.error("Instagram is not connected — open Settings in Circuit and connect it first.");
  process.exit(1);
}

const want = db
  .prepare(`SELECT id, origin, title FROM inspirations
            WHERE platform = 'Instagram' AND video_file_id IS NULL AND origin LIKE 'ig:%'`)
  .all();

if (!want.length) {
  console.log("Nothing to do — every saved Instagram post already has its video, or none came from the sync.");
  process.exit(0);
}

const byPermalink = new Map(want.map((r) => [r.origin.slice(3), r]));
console.log(`${want.length} saved posts have no video. Asking Instagram for fresh links…\n`);

/* Competitors live as JSON in settings, not a table of their own. */
const competitors = (() => {
  try { return JSON.parse(setting("competitors") || "[]"); } catch { return []; }
})().filter((c) => c && c.instagram);

if (!competitors.length) {
  console.error("No competitor has an Instagram handle saved, so there is nothing to ask about.");
  process.exit(1);
}

const setVideo = db.prepare("UPDATE inspirations SET video_file_id = ? WHERE id = ?");
const addFile = db.prepare(
  "INSERT INTO files (id, name, mime, size, path, kind, created_at) VALUES (?, ?, ?, ?, ?, 'inspiration', ?)",
);

let filled = 0;
let bytes = 0;

for (const c of competitors) {
  const handle = c.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
  const fields =
    `business_discovery.username(${handle})` +
    `{media.limit(25){media_type,media_product_type,permalink,media_url,thumbnail_url}}`;
  const url = new URL(`https://graph.facebook.com/${API}/${igUser}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);

  let posts = [];
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = await r.json();
    if (body.error) throw new Error(body.error.message || "Instagram refused the request");
    posts = body?.business_discovery?.media?.data || [];
  } catch (e) {
    console.log(`  ${c.name}: ${e.message}`);
    continue;
  }

  for (const p of posts) {
    const row = p.permalink ? byPermalink.get(p.permalink) : undefined;
    if (!row) continue;
    const moving = p.media_type === "VIDEO" || p.media_product_type === "REELS";
    /* media_url is the MP4 only for something that moves; on a photo it is the image, and
       filing that as a video would be worse than leaving the row alone. */
    if (!moving || !p.media_url) continue;

    try {
      const res = await fetch(p.media_url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_VIDEO_BYTES) throw new Error(`${(buf.length / 1e6).toFixed(0)} MB is over the ceiling`);

      const id = randomUUID();
      const rel = `${id}.mp4`;
      fs.mkdirSync(UPLOADS, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS, rel), buf);
      addFile.run(id, `${(row.title || "reel").slice(0, 40)}.mp4`, "video/mp4", buf.length, rel, new Date().toISOString());
      setVideo.run(id, row.id);

      byPermalink.delete(p.permalink);
      filled += 1;
      bytes += buf.length;
      console.log(`  ✓ ${c.name} — ${(row.title || "").slice(0, 46)}  (${(buf.length / 1e6).toFixed(1)} MB, ${(bytes / 1e6).toFixed(0)} MB so far)`);
    } catch (e) {
      console.log(`  × ${c.name} — ${(row.title || "").slice(0, 46)}: ${e.message}`);
    }
  }
}

console.log(
  `\n${filled} video${filled === 1 ? "" : "s"} fetched, ${(bytes / 1e6).toFixed(0)} MB.` +
    (byPermalink.size
      ? `\n${byPermalink.size} could not be reached — Business Discovery only returns an account's most recent posts, so these have fallen out of that window, or were deleted. They keep their cover frame.`
      : ""),
);
