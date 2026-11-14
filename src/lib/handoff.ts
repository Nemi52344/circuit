import { getDb, getSetting, now, getFile, tryFilePath } from "@/lib/db";
import { uploadPublic } from "@/lib/supabase";
import { publishAllowed } from "@/lib/signoff";
import fs from "fs";
import path from "path";

/* The door Mark comes through.

   Circuit can publish to Instagram and the Facebook page itself, through Meta's own API. It
   cannot publish to LinkedIn or X: LinkedIn only lets approved partner apps post, and X now
   charges per post. Mark — the ChatGPT dot — has its own cloud browser already signed in to
   both, so the work it can do is exactly the work Circuit cannot.

   So this is a hand-over, not an integration. Circuit stays the record: it decides what goes
   out, when, and with which picture, and it keeps the evidence afterwards. Mark is told about
   one post at a time and reports back where it landed.

   Three things live behind this door and nothing else. Mark cannot read the brand, the bills,
   the card statements, the settings or any token — not because it would misuse them, but
   because this endpoint is reachable from outside this computer and an endpoint should offer only
   what its job needs. If LinkedIn and X publishing ever moves into Circuit proper, this file
   is the only thing to delete. */

/* LinkedIn and X only. Instagram and Facebook are Circuit's own work and are deliberately not
   offered here — handing them to a browser agent would swap a supported API for screen-driving,
   and lose the audit trail that comes with publishing as the app. */
export const HANDOFF_PLATFORMS = ["LinkedIn", "X"] as const;

export type HandoffPost = {
  id: string;
  platform: string;
  caption: string;
  scheduled_for: string;
  days_late: number;
  image_url: string | null;
  image_note?: string;
  blocked?: string;
  topic: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/* The shared secret Mark presents. Absent means the door is shut — a missing secret must never
   read as "no check required", which is how an endpoint meant for one caller ends up open to
   everyone. */
export function handoffSecret(): string | null {
  const s = (getSetting("handoff_secret") || "").trim();
  return s.length >= 24 ? s : null;
}

export function authorised(req: Request): boolean {
  const want = handoffSecret();
  if (!want) return false;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (got.length !== want.length) return false;
  /* Compared in full every time: bailing out at the first wrong character leaks the secret one
     character at a time to anyone willing to measure how long the answer took. */
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/* What is waiting, oldest first. Only posts a person has already moved to ready: a draft nobody
   has looked at is not something to hand to an agent with publishing rights. */
export function dueForHandoff(withinDays = 14): HandoffPost[] {
  const until = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const marks = HANDOFF_PLATFORMS.map(() => "?").join(",");
  const rows = getDb().prepare(`
    SELECT p.id, p.platform, p.caption, p.scheduled_at, p.status,
           COALESCE(p.file_id, c.file_id) AS image, s.topic
    FROM posts p
    LEFT JOIN creations c ON c.id = p.creation_id
    LEFT JOIN slots s ON s.id = p.slot_id
    WHERE p.platform IN (${marks})
      AND p.status != 'posted'
      AND substr(p.scheduled_at, 1, 10) <= ?
    ORDER BY p.scheduled_at`)
    .all(...HANDOFF_PLATFORMS, until) as
      { id: string; platform: string; caption: string; scheduled_at: string; image: string | null; topic: string | null }[];

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    caption: r.caption || "",
    scheduled_for: r.scheduled_at.slice(0, 10),
    days_late: Math.max(0, daysBetween(r.scheduled_at.slice(0, 10), today())),
    image_url: null,
    topic: r.topic || "",
  }));
}

/* One post, with its picture somewhere Mark's browser can actually fetch.

   The upload happens here rather than in the listing because it costs a network round trip per
   post, and a listing of ten should not push ten images into a bucket on the chance that one of
   them gets used. */
export async function postForHandoff(id: string): Promise<HandoffPost | null> {
  const post = dueForHandoff(3650).find((p) => p.id === id);
  if (!post) return null;

  /* Mark goes through the same gate as Circuit's own publishing. An agent on somebody else's
     computer is the last caller that should get an exception from sign-off.

     A blocked post hands back the reason and nothing else — no caption, no picture. Returning
     the words with a "do not post this" beside them relies on the agent choosing to obey, and
     the point of a gate is that it does not depend on that. */
  const gate = publishAllowed(id);
  if (!gate.ok) {
    return { ...post, caption: "", image_url: null, blocked: gate.reason };
  }

  const row = getDb().prepare(`
    SELECT COALESCE(p.file_id, c.file_id) AS image
    FROM posts p LEFT JOIN creations c ON c.id = p.creation_id WHERE p.id = ?`)
    .get(id) as { image: string | null } | undefined;

  /* A missing picture does not throw: Mark can still post the words, and a post that went out
     without its image is a visible problem where a step that died halfway is a silent one. But
     it must say why. A bare null reads as "this post has no picture", and the first version of
     this function returned exactly that for every post because it looked for the file in the
     wrong place — the stored path is relative to the uploads folder. An unexplained null hides
     its own bugs. */
  if (!row?.image) {
    post.image_note = "This post has no picture attached.";
    return post;
  }
  const f = getFile(row.image);
  if (!f) {
    post.image_note = "The picture is no longer in the library. Post the words alone and say so.";
    return post;
  }
  const full = tryFilePath(f);
  if (!fs.existsSync(full)) {
    post.image_note = "The picture is not stored in Circuit. Post the words alone and say so.";
    return post;
  }
  const up = await uploadPublic("handoff", `${id}${path.extname(f.name) || ".jpg"}`, fs.readFileSync(full), f.mime || "image/jpeg");
  if (up.ok) post.image_url = up.url;
  else post.image_note = `The picture could not be put somewhere you can fetch it: ${up.error}`;
  return post;
}

/* Mark reporting back. The live link is the whole point: without it there is no evidence the
   post exists, nothing to check later, and no way to tell a real publish from an agent that
   believed it had published. So a post is only marked done when a link comes with it. */
export function recordPublished(id: string, url: string): { ok: boolean; error?: string } {
  const link = (url || "").trim();
  if (!/^https?:\/\//i.test(link)) return { ok: false, error: "A live link is required — it is the evidence the post exists" };

  const db = getDb();
  const post = db.prepare("SELECT platform, status FROM posts WHERE id = ?").get(id) as { platform: string; status: string } | undefined;
  if (!post) return { ok: false, error: "That post is not here any more" };
  if (!(HANDOFF_PLATFORMS as readonly string[]).includes(post.platform)) {
    return { ok: false, error: `${post.platform} is published by Circuit itself, not through the hand-over` };
  }
  if (post.status === "posted") return { ok: false, error: "That one is already marked as gone out" };

  db.prepare("UPDATE posts SET status = 'posted', posted_url = ?, updated_at = ? WHERE id = ?").run(link, now(), id);
  return { ok: true };
}
