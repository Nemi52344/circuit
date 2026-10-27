import { handle, handleCan, ok, bad, readJson } from "@/lib/http";
import {
  listConversations, findConversations, draftOptions, chooseOption, saveConversation, refreshPost, addByLink,
  removeConversation, joinSummary, checkLink, PLATFORMS, STATUSES, ANGLES, VOICES, type Conversation,
} from "@/lib/joinin";
import { getDb, now } from "@/lib/db";

export const runtime = "nodejs";

/* Posts on LinkedIn and X that are worth replying to, and what we would say.

   Nothing here posts anything. There is no route that could: Circuit finds the link, writes the
   draft, and a person opens the post and leaves the comment themselves. */

export const GET = handle(async (req) => {
  const status = new URL(req.url).searchParams.get("status") || "";
  return ok({
    conversations: listConversations(status),
    summary: joinSummary(),
    platforms: PLATFORMS,
    statuses: STATUSES,
    angles: ANGLES,
    voices: VOICES,
  });
});

export const POST = handleCan("create", async (req) => {
  const b = await readJson<{ action?: string; id?: string; platforms?: string[]; topics?: string; limit?: number; voice?: string; index?: number; url?: string }>(req);

  /* Go and look. Slow — it is a search and then a fetch per link — so the page says so. */
  if (b.action === "find") {
    try { return ok(await findConversations({ platforms: b.platforms, topics: b.topics, limit: b.limit }), 201); }
    catch (e) { return bad((e as Error).message); }
  }

  /* Five ways to answer, one per angle. Slow — it is one ChatGPT call that writes all five. */
  if (b.action === "draft") {
    if (!b.id) return bad("id required");
    try { return ok(await draftOptions(b.id, b.voice), 201); }
    catch (e) { return bad((e as Error).message); }
  }

  if (b.action === "choose") {
    if (!b.id) return bad("id required");
    if (typeof b.index !== "number") return bad("index required");
    try { return ok(chooseOption(b.id, b.index)); }
    catch (e) { return bad((e as Error).message); }
  }

  /* A post you found yourself. The only route to X, and the better one for LinkedIn. */
  if (b.action === "add") {
    if (!b.url?.trim()) return bad("Paste the link to a post");
    try { return ok(await addByLink(b.url), 201); }
    catch (e) { return bad((e as Error).message); }
  }

  /* Read the post itself — for rows saved before Circuit knew how, and for posts since edited. */
  if (b.action === "refresh") {
    if (!b.id) return bad("id required");
    try { return ok(await refreshPost(b.id)); }
    catch (e) { return bad((e as Error).message); }
  }

  /* Try a link again. A post that was blocked an hour ago is usually still blocked, but a
     link checked once and never again slowly becomes a list of guesses. */
  if (b.action === "recheck") {
    if (!b.id) return bad("id required");
    const row = getDb().prepare("SELECT url FROM conversations WHERE id = ?").get(b.id) as { url: string } | undefined;
    if (!row) return bad("That conversation is not here any more", 404);
    const reachable = await checkLink(row.url);
    getDb().prepare("UPDATE conversations SET reachable = ?, updated_at = ? WHERE id = ?").run(reachable, now(), b.id);
    return ok({ id: b.id, reachable });
  }

  return bad("Unknown action");
});

export const PATCH = handleCan("create", async (req) => {
  const b = await readJson<Partial<Conversation> & { id?: string }>(req);
  if (!b.id) return bad("id required");
  try { return ok(saveConversation({ ...b, id: b.id })); }
  catch (e) { return bad((e as Error).message); }
});

export const DELETE = handleCan("create", async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(removeConversation(id));
});
