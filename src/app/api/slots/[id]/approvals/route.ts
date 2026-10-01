import { handle, ok, bad, readJson } from "@/lib/http";
import { approvalSummary, requestApprovals, reviewBases } from "@/lib/approvals";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  return ok({ ...approvalSummary(id), bases: reviewBases() });
});

/* Ask for sign-off: creates a personal review link for everyone who hasn't approved this version. */
export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const b = await readJson<{ action?: string }>(req);
  if (b.action !== "request") return bad("Unknown action");
  const db = getDb();
  const slot = db.prepare("SELECT format, final_creation_id FROM slots WHERE id = ?").get(id) as { format: string; final_creation_id: string | null } | undefined;
  if (!slot) return bad("Post not found", 404);
  if (slot.format !== "text" && !slot.final_creation_id) return bad("Approve the final image first");
  const content = (db.prepare("SELECT COUNT(*) n FROM slot_content WHERE slot_id = ?").get(id) as { n: number }).n;
  if (!content) return bad("Save the captions first");
  const r = requestApprovals(id);
  if (!r.summary.approvers) return bad("Add approvers in Settings first");
  return ok({ ...r, bases: reviewBases() });
});
