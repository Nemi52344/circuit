import fs from "fs";
import path from "path";
import { getDb, getSetting, now, UPLOAD_DIR, getFile } from "@/lib/db";
import { META_API_VERSION } from "@/lib/meta";
import { uploadPublic } from "@/lib/supabase";
import { publishAllowed } from "@/lib/signoff";

/* Putting a post out, properly.

   Not by driving a browser and pretending to be a person. Meta gives an application the right to
   publish on behalf of a page or an Instagram account, through an agreement the company made
   when it created the app — which is why it keeps working when Instagram redesigns its web
   interface, and why it is not against anybody's terms.

   Instagram takes two calls and a wait: a container is made from a picture and a caption, then
   the container is published. The picture has to be somewhere Meta can fetch it, which is what
   the Supabase bucket is for — the same one holding the briefings.

   Nothing here runs on a schedule. Publishing is irreversible and public, so it happens when a
   person presses the button and not before. */

const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

export type CanPublish = {
  platform: string; ready: boolean; missing: string[]; note: string;
};

const scopes = () => (getSetting("meta_token_scopes") || "").split(",").map((s) => s.trim()).filter(Boolean);

/* What the token is allowed to do, said plainly rather than discovered by a failure at 09:30. */
export function publishable(): CanPublish[] {
  const have = scopes();
  const token = Boolean(getSetting("meta_token"));
  /* A token whose permissions were never read is a different state from a token known to be
     short of one. Naming a specific missing permission here would be a claim about a credential
     Circuit never inspected — and the likeliest way to reach this state is a good token saved
     while Meta was unreachable, which is exactly when a confident wrong answer costs most. */
  const unread = token && !have.length;
  const need = (list: string[]) => (unread ? [] : list.filter((s) => !have.includes(s)));

  const ig = need(["instagram_content_publish"]);
  const fb = need(["pages_manage_posts", "pages_show_list"]);
  const unreadNote = "Meta would not say what this token is allowed to do. Open Settings and press Check connection.";
  return [
    {
      platform: "Instagram", ready: token && !unread && !ig.length, missing: unread ? ["unknown"] : ig,
      note: !token ? "Meta is not connected."
        : unread ? unreadNote
        : ig.length ? `The token was granted without ${ig.join(" and ")}. Reconnect Meta in Settings with that ticked.`
        : "Circuit can publish to Instagram itself.",
    },
    {
      platform: "Facebook", ready: token && !unread && !fb.length, missing: unread ? ["unknown"] : fb,
      note: !token ? "Meta is not connected."
        : unread ? unreadNote
        : fb.length ? `The token was granted without ${fb.join(" and ")}. Reconnect Meta in Settings with that ticked.`
        : "Circuit can publish to the page itself.",
    },
    { platform: "LinkedIn", ready: false, missing: ["postiz"], note: "LinkedIn only lets approved partner apps publish. Postiz holds that relationship — add its key in Settings." },
    { platform: "X", ready: false, missing: ["postiz"], note: "Publishing to X needs a paid API tier, or Postiz." },
  ];
}

async function graph(p: string, body: Record<string, string>) {
  const r = await fetch(`${GRAPH}/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(90000),
  });
  const j = (await r.json()) as { id?: string; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "Meta refused that");
  return j;
}

/* The picture, somewhere Meta can fetch it from. */
async function pictureUrl(fileId: string): Promise<string> {
  const row = getFile(fileId);
  if (!row) throw new Error("That picture is not in the library any more");
  const full = path.join(UPLOAD_DIR, row.path);
  if (!fs.existsSync(full)) throw new Error("That picture has gone missing from disk");
  const up = await uploadPublic("to-post", `${fileId}${path.extname(row.name) || ".jpg"}`, fs.readFileSync(full), row.mime || "image/jpeg");
  if (!up.ok) throw new Error(up.error);
  return up.url;
}

/* The page this token can post to, and its own token — a page post is signed by the page, not
   by the person who granted the permission. */
async function page(): Promise<{ id: string; token: string; name: string }> {
  const token = getSetting("meta_token");
  const r = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${token}`, { signal: AbortSignal.timeout(60000) });
  const j = (await r.json()) as { data?: { id: string; name: string; access_token: string }[]; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  const pages = j.data || [];
  if (!pages.length) throw new Error("This token does not reach any Facebook page");
  const names = () => pages.map((p) => `${p.name} (${p.id})`).join(", ");

  /* Never fall back to "the first page". A Meta account commonly administers several pages —
     this one reaches five across three different companies — and the first one the API happens
     to return is not the brand's. Publishing is public and cannot be taken back, so an
     unanswerable question has to stop the post, not pick for itself. */
  const want = getSetting("fb_page_id");
  if (want) {
    const pinned = pages.find((p) => p.id === want);
    if (!pinned) throw new Error(`The Facebook page set in Settings (${want}) is not on this token. It reaches: ${names()}`);
    return { id: pinned.id, token: pinned.access_token, name: pinned.name };
  }

  /* Nothing pinned: the page that owns the Instagram account Circuit already posts to is the
     only defensible answer, because it is the same brand by definition. */
  const ig = getSetting("ig_user_id");
  if (ig) {
    const linked = await fetch(`${GRAPH}/me/accounts?fields=id,instagram_business_account{id}&access_token=${token}`, { signal: AbortSignal.timeout(60000) })
      .then((x) => x.json() as Promise<{ data?: { id: string; instagram_business_account?: { id: string } }[] }>)
      .catch(() => ({ data: [] as { id: string; instagram_business_account?: { id: string } }[] }));
    const match = (linked.data || []).find((p) => p.instagram_business_account?.id === ig);
    const owner = match && pages.find((p) => p.id === match.id);
    if (owner) return { id: owner.id, token: owner.access_token, name: owner.name };
  }
  throw new Error(`Set which Facebook page to post to — this token reaches: ${names()}`);
}

export type Published = { ok: boolean; url: string; error: string; platform: string };

export async function publishPost(postId: string): Promise<Published> {
  const db = getDb();
  const post = db.prepare(`
    SELECT p.*, COALESCE(p.file_id, c.file_id) AS image
    FROM posts p LEFT JOIN creations c ON c.id = p.creation_id WHERE p.id = ?`)
    .get(postId) as { id: string; platform: string; caption: string; status: string; image: string | null } | undefined;
  if (!post) return { ok: false, url: "", error: "That post is not here any more", platform: "" };
  if (post.status === "posted") return { ok: false, url: "", error: "That one has already gone out", platform: post.platform };

  /* Sign-off before anything else. A post that has not been cleared should not even get as far
     as having its picture uploaded. */
  const gate = publishAllowed(postId);
  if (!gate.ok) return { ok: false, url: "", error: gate.reason, platform: post.platform };

  const can = publishable().find((c) => c.platform === post.platform);
  if (!can?.ready) return { ok: false, url: "", error: can?.note || `Circuit cannot publish to ${post.platform}`, platform: post.platform };
  if (!post.image) return { ok: false, url: "", error: "There is no picture on this post", platform: post.platform };

  const token = getSetting("meta_token") as string;
  try {
    const img = await pictureUrl(post.image);
    let link = "";

    if (post.platform === "Instagram") {
      const user = getSetting("ig_user_id");
      /* A container first, then publish it. Meta fetches the picture in between, which is why
         the two calls are separate and why the URL has to stay reachable until it has. */
      const made = await graph(`${user}/media`, { image_url: img, caption: post.caption || "", access_token: token });
      if (!made.id) throw new Error("Instagram did not make the post container");
      const out = await graph(`${user}/media_publish`, { creation_id: made.id, access_token: token });
      const r = await fetch(`${GRAPH}/${out.id}?fields=permalink&access_token=${token}`, { signal: AbortSignal.timeout(60000) });
      link = ((await r.json()) as { permalink?: string }).permalink || "";
    } else {
      const pg = await page();
      const out = await graph(`${pg.id}/photos`, { url: img, caption: post.caption || "", access_token: pg.token });
      link = out.id ? `https://www.facebook.com/${out.id}` : "";
    }

    /* The live link is the evidence, so it is written down in the same breath as the publish. */
    db.prepare("UPDATE posts SET status = 'posted', posted_url = ?, updated_at = ? WHERE id = ?").run(link, now(), postId);
    return { ok: true, url: link, error: "", platform: post.platform };
  } catch (e) {
    return { ok: false, url: "", error: (e as Error).message, platform: post.platform };
  }
}
