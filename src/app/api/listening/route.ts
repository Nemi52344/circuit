import { handle, ok, bad, readJson } from "@/lib/http";
import {
  listComments, addComment, saveComment, removeComment, draftReplies, pullInstagram,
  reach, listenSummary, KINDS, STATUSES, type Comment,
} from "@/lib/listen";

export const runtime = "nodejs";
export const maxDuration = 800;

export const GET = handle(async () => ok({
  comments: listComments(), summary: listenSummary(), reach: reach(), kinds: KINDS, statuses: STATUSES,
}));

export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string; platform?: string; paste?: string; limit?: number } & Partial<Comment>>(req);

  if (b.action === "draft") return ok(await draftReplies(Math.min(b.limit || 10, 25)));
  if (b.action === "pull") return ok(await pullInstagram(Math.min(b.limit || 8, 25)));

  /* Comments pasted in from LinkedIn or X, one per line as "name: what they said" — the shape
     they come out of a browser in, so nobody has to tidy them first. */
  if (b.action === "paste") {
    const platform = b.platform || "LinkedIn";
    const lines = (b.paste || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return bad("Nothing pasted");
    const made = lines.map((line) => {
      const at = line.indexOf(":");
      const author = at > 0 && at < 40 ? line.slice(0, at).trim() : "";
      const text = at > 0 && at < 40 ? line.slice(at + 1).trim() : line;
      return addComment({ platform, author, text, post_title: b.post_title || "", post_ref: b.post_ref || "", source: "pasted" });
    });
    return ok({ added: made.length });
  }

  if (!b.id) return bad("id required");
  return ok(saveComment({ ...b, id: b.id }));
});

export const DELETE = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  return ok(removeComment(id));
});
