import { getDb } from "@/lib/db";
import { handleUser, handleCan, ok, bad, readJson } from "@/lib/http";
import { listVideoJobs, queueVideo, retryVideo, videoTools, workVideoQueue, type VideoOptions } from "@/lib/videoedit";

/* The video studio: what footage there is, what is being edited, and "edit this". Making
   content is a creator's job, so anyone who can create may start an edit. */
export const runtime = "nodejs";

export const GET = handleUser(async () => {
  /* Our own footage only. Inspiration is other brands' work, kept for ideas — editing it into a
     reel and posting it as ours is the one thing this studio must never make easy. */
  const videos = getDb().prepare(`SELECT id, name, title, tags, size, kind, created_at FROM files
    WHERE mime LIKE 'video/%' AND kind NOT IN ('generated', 'inspiration') ORDER BY (kind = 'raw') DESC, created_at DESC LIMIT 120`).all();
  return ok({ jobs: listVideoJobs(20), tools: videoTools(), videos });
});

export const POST = handleCan("create", async (req, user) => {
  const b = await readJson<{ source_file_id?: string; options?: Partial<VideoOptions> }>(req);
  if (!b.source_file_id) return bad("Pick a video first");
  const job = queueVideo(b.source_file_id, b.options || {}, user);
  /* Start now rather than at the worker's next tick; it carries on after this answer. */
  workVideoQueue().catch(() => null);
  return ok(job, 201);
});

export const PATCH = handleCan("create", async (req) => {
  const b = await readJson<{ action?: string; id?: string }>(req);
  if (b.action === "retry" && b.id) { retryVideo(b.id); workVideoQueue().catch(() => null); return ok({ retrying: true }); }
  return bad("Unknown action");
});
