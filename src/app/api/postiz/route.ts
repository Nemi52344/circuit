import { getDb, setSetting, now } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { postizStatus, saveChannelMap, sendToPostiz, plannedSend, type OutgoingPost } from "@/lib/postiz";
import { approvalSummary } from "@/lib/approvals";

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = handle(async (req) => {
  const slot = new URL(req.url).searchParams.get("slot");
  const status = await postizStatus();
  return ok(slot ? { ...status, plan: plannedSend(slot) } : status);
});

export const POST = handle(async (req) => {
  const b = await readJson<{
    action?: string; key?: string | null; url?: string | null; map?: Record<string, string>;
    slot_id?: string; type?: "draft" | "schedule"; platforms?: string[];
  }>(req);

  if (b.action === "connect") {
    const key = (b.key || "").trim();
    if (key) setSetting("postiz_key", key); else getDb().prepare("DELETE FROM settings WHERE key = 'postiz_key'").run();
    if (b.url !== undefined) {
      const u = (b.url || "").trim();
      if (u) setSetting("postiz_url", u); else getDb().prepare("DELETE FROM settings WHERE key = 'postiz_url'").run();
    }
    return ok(await postizStatus());
  }

  if (b.action === "map") {
    saveChannelMap(b.map || {});
    return ok(await postizStatus());
  }

  /* Sending. A draft is always allowed; scheduling is held to the same sign-off rule as the
     rest of Circuit, so nothing reaches a platform that the team hasn't approved. */
  if (b.action === "send") {
    if (!b.slot_id) return bad("slot_id required");
    const plan = plannedSend(b.slot_id);
    const type = b.type === "schedule" ? "schedule" : "draft";
    if (type === "schedule") {
      const so = approvalSummary(b.slot_id);
      if (so.required && !so.ready) return bad(`Waiting for sign-off from ${so.missing.join(", ") || "the approvers"}`, 409);
    }
    const wanted = b.platforms?.length ? new Set(b.platforms) : null;
    const posts: OutgoingPost[] = plan.items
      .filter((i) => i.ready && (!wanted || wanted.has(i.platform)))
      .map((i) => ({ platform: i.platform, channelId: i.channelId, content: i.caption }));
    if (!posts.length) return bad("Nothing ready to send: every platform needs a caption and a channel");

    const result = await sendToPostiz({ posts, when: plan.when, fileId: plan.file_id, type });
    getDb().prepare("UPDATE slots SET updated_at = ? WHERE id = ?").run(now(), b.slot_id);
    return ok({ sent: posts.map((p) => p.platform), type, result });
  }

  return bad("Unknown action");
});
