import { getDb } from "@/lib/db";
import { handle, ok, bad, readJson } from "@/lib/http";
import { approvalByToken, decide, postVersion } from "@/lib/approvals";

export const runtime = "nodejs";

/* What one approver sees through their personal link: the image and every caption, nothing else. */
export const GET = handle(async (_req, { params }) => {
  const { token } = await params;
  const a = approvalByToken(token);
  if (!a) return bad("This review link isn't valid", 404);
  const db = getDb();
  const slot = db.prepare("SELECT s.id, s.date, s.time, s.topic, s.format, s.platforms, p.name AS pillar, c.file_id AS image_file_id FROM slots s LEFT JOIN pillars p ON p.id = s.pillar_id LEFT JOIN creations c ON c.id = s.final_creation_id WHERE s.id = ?")
    .get(a.slot_id) as Record<string, string> | undefined;
  if (!slot) return bad("This post was removed", 404);
  const content = (db.prepare("SELECT platform, caption, meta FROM slot_content WHERE slot_id = ? ORDER BY platform").all(a.slot_id) as { platform: string; caption: string; meta: string }[])
    .map((c) => { let m: Record<string, string> = {}; try { m = JSON.parse(c.meta || "{}"); } catch { m = {}; } return { platform: c.platform, caption: c.caption, hashtags: m.hashtags || "", title: m.title || "", link: m.link || "" }; });
  const slides = db.prepare("SELECT position, headline, body, file_id FROM slot_slides WHERE slot_id = ? ORDER BY position, created_at").all(a.slot_id);
  return ok({
    approver: { name: a.name, role: a.role },
    slides,
    status: a.status, comment: a.comment, decided_at: a.decided_at,
    stale: a.version !== postVersion(a.slot_id),
    post: { topic: slot.topic, date: slot.date, time: slot.time, format: slot.format, pillar: slot.pillar, image_file_id: slot.image_file_id, platforms: JSON.parse(slot.platforms || "[]") },
    content,
  });
});

export const POST = handle(async (req, { params }) => {
  const { token } = await params;
  const b = await readJson<{ status?: string; comment?: string }>(req);
  if (b.status !== "approved" && b.status !== "changes") return bad("Choose approve or request changes");
  try {
    const s = decide(token, b.status, b.comment || "");
    return ok({ saved: true, ready: s.ready });
  } catch (e) {
    return bad((e as Error).message, 409);
  }
});
