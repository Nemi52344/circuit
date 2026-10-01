import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting, getFile, UPLOAD_DIR, now } from "@/lib/db";

/* Publishing, through Postiz.

   Circuit makes the post; Postiz puts it on the platforms. That split is deliberate: every
   network wants its own reviewed developer app, its own OAuth and a publicly reachable image,
   none of which a laptop can offer. Postiz already holds all of that.

   The contract below is taken from Postiz's own SDK and DTOs, not guessed:
     GET  {base}/public/v1/integrations      -> the connected channels
     POST {base}/public/v1/upload            -> multipart "file", returns { id, path }
     POST {base}/public/v1/posts             -> { type, date, shortLink, tags, posts[] }
     DELETE {base}/public/v1/posts/:id
   Auth is the API key in the Authorization header, with no "Bearer" prefix.

   Nothing here publishes on its own. Circuit sends drafts unless the owner explicitly asks to
   schedule, and the sign-off rules upstream still decide whether that is allowed at all. */

const CLOUD = "https://api.postiz.com";

export type Channel = { id: string; name: string; identifier: string; picture?: string; disabled?: boolean; profile?: string };
export type PostizStatus = {
  connected: boolean; base: string; channels: Channel[]; error: string;
  map: Record<string, string>; self_hosted: boolean;
};

export const postizKey = () => getSetting("postiz_key") || "";
export const postizBase = () => (getSetting("postiz_url") || CLOUD).replace(/\/+$/, "");

export function channelMap(): Record<string, string> {
  try { return JSON.parse(getSetting("postiz_map") || "{}"); } catch { return {}; }
}
export function saveChannelMap(map: Record<string, string>) {
  setSetting("postiz_map", JSON.stringify(map));
}

async function call(pathname: string, init: RequestInit = {}) {
  const key = postizKey();
  if (!key) throw new Error("needs_postiz_key");
  const r = await fetch(`${postizBase()}/public/v1${pathname}`, {
    ...init,
    headers: { Authorization: key, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers || {}) },
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    const msg = typeof data === "object" && data && "message" in data ? String((data as { message: unknown }).message) : `HTTP ${r.status}`;
    throw new Error(r.status === 401 ? "Postiz refused the API key" : r.status === 429 ? "Postiz rate limit reached, try again shortly" : msg);
  }
  return data;
}

export async function listChannels(): Promise<Channel[]> {
  const r = (await call("/integrations")) as Channel[] | { integrations?: Channel[] };
  return Array.isArray(r) ? r : r.integrations || [];
}

export async function postizStatus(): Promise<PostizStatus> {
  const base = postizBase();
  const out: PostizStatus = { connected: false, base, channels: [], error: "", map: channelMap(), self_hosted: base !== CLOUD };
  if (!postizKey()) { out.error = "No API key saved yet"; return out; }
  try {
    out.channels = await listChannels();
    out.connected = true;
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}

/* Postiz will only publish media it hosts itself, so the approved picture is uploaded first. */
export async function uploadPicture(fileId: string): Promise<{ id: string; path: string }> {
  const f = getFile(fileId);
  if (!f) throw new Error("That picture is missing from the library");
  const full = path.join(UPLOAD_DIR, f.path);
  if (!fs.existsSync(full)) throw new Error("That picture is missing from disk");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fs.readFileSync(full))], { type: f.mime || "image/jpeg" }), f.name || "picture.jpg");
  const r = (await call("/upload", { method: "POST", body: form })) as { id?: string; path?: string };
  if (!r?.path) throw new Error("Postiz didn't return the uploaded picture");
  return { id: r.id || "", path: r.path };
}

export type OutgoingPost = { platform: string; channelId: string; content: string };

/* One send: the same picture, each platform's own caption, one time.
   `type` is "draft" by default — a draft sits in Postiz until somebody presses publish there. */
export async function sendToPostiz(opts: {
  posts: OutgoingPost[];
  when: string;
  fileId?: string | null;
  type?: "draft" | "schedule";
}) {
  if (!opts.posts.length) throw new Error("No channels chosen");
  const media = opts.fileId ? [await uploadPicture(opts.fileId)] : [];
  const body = {
    type: opts.type || "draft",
    date: new Date(opts.when).toISOString(),
    shortLink: false,
    tags: [] as { value: string; label: string }[],
    posts: opts.posts.map((p) => ({
      integration: { id: p.channelId },
      value: [{ content: p.content, image: media }],
      // settings are only validated when something is actually scheduled
      ...(opts.type === "schedule" ? { settings: settingsFor(p.platform) } : {}),
    })),
  };
  const r = (await call("/posts", { method: "POST", body: JSON.stringify(body) })) as unknown;
  setSetting("postiz_last_send", JSON.stringify({ at: now(), type: body.type, channels: opts.posts.length }));
  return r;
}

/* The per-network bits Postiz needs when a post is really scheduled. Kept minimal on purpose:
   anything Circuit doesn't understand is better left to Postiz's own defaults. */
function settingsFor(platform: string): Record<string, unknown> {
  const p = platform.toLowerCase();
  if (p.includes("instagram")) return { __type: "instagram", post_type: "post" };
  if (p.includes("facebook")) return { __type: "facebook" };
  if (p.includes("linkedin")) return { __type: "linkedin" };
  if (p === "x" || p.includes("twitter")) return { __type: "x", who_can_reply_post: "everyone" };
  if (p.includes("youtube")) return { __type: "youtube", title: "", type: "public" };
  return { __type: p };
}

export async function deletePostizPost(id: string) {
  return call(`/posts/${id}`, { method: "DELETE" });
}

/* What Circuit would send for a slot: the approved picture and one caption per platform that
   has a channel mapped. Read-only — this is what the Schedule step shows before anything moves. */
export function plannedSend(slotId: string) {
  const db = getDb();
  const slot = db.prepare("SELECT id, date, time, platforms, topic, final_creation_id FROM slots WHERE id = ?").get(slotId) as
    { id: string; date: string; time: string; platforms: string; topic: string; final_creation_id: string | null } | undefined;
  if (!slot) throw new Error("Post not found");
  const content = db.prepare("SELECT platform, caption, scheduled_at FROM slot_content WHERE slot_id = ?").all(slotId) as
    { platform: string; caption: string; scheduled_at: string }[];
  const file = slot.final_creation_id
    ? (db.prepare("SELECT file_id FROM creations WHERE id = ?").get(slot.final_creation_id) as { file_id: string } | undefined)?.file_id || null
    : null;
  const map = channelMap();
  return {
    slot,
    file_id: file,
    when: content[0]?.scheduled_at || `${slot.date}T${slot.time || "10:00"}`,
    items: content.map((c) => ({
      platform: c.platform,
      caption: c.caption,
      channelId: map[c.platform] || "",
      ready: Boolean(map[c.platform] && c.caption.trim()),
    })),
  };
}
