import crypto from "node:crypto";
import os from "node:os";
import { getDb, newId, now } from "@/lib/db";

/* Sign-off by named people before a post can be scheduled. Every approval is tied to the exact
   version it was given for (final image + every platform's caption); editing either makes the
   old approvals stale, so nobody signs off one thing and sees another go out. */

export type Approver = { id: string; name: string; role: string; email: string; required: number; active: number; created_at: string };
export type ApprovalItem = {
  id: string; approver_id: string; name: string; role: string; email: string; required: boolean;
  status: "pending" | "approved" | "changes"; comment: string; token: string; requested_at: string; decided_at: string; stale: boolean;
};
export type ApprovalSummary = {
  approvers: number; required: number; approved: number; changes: number; pending: number;
  requested: boolean; ready: boolean; version: string; items: ApprovalItem[]; missing: string[];
};

export function listApprovers(activeOnly = false): Approver[] {
  return getDb().prepare(`SELECT * FROM approvers ${activeOnly ? "WHERE active = 1" : ""} ORDER BY created_at`).all() as Approver[];
}

export function postVersion(slotId: string) {
  const db = getDb();
  const slot = db.prepare("SELECT final_creation_id, format FROM slots WHERE id = ?").get(slotId) as { final_creation_id: string | null; format: string } | undefined;
  const content = db.prepare("SELECT platform, caption, meta FROM slot_content WHERE slot_id = ? ORDER BY platform").all(slotId) as { platform: string; caption: string; meta: string }[];
  const basis = JSON.stringify({ image: slot?.final_creation_id || "", content: content.map((c) => {
    let meta: Record<string, string> = {};
    try { meta = JSON.parse(c.meta || "{}"); } catch { meta = {}; }
    return [c.platform, c.caption, meta.hashtags || "", meta.title || "", meta.link || ""];
  }) });
  return crypto.createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

export function approvalSummary(slotId: string): ApprovalSummary {
  const db = getDb();
  const version = postVersion(slotId);
  const approvers = listApprovers(true);
  const rows = db.prepare(
    `SELECT a.* FROM approvals a WHERE a.slot_id = ? AND a.requested_at = (SELECT MAX(b.requested_at) FROM approvals b WHERE b.slot_id = a.slot_id AND b.approver_id = a.approver_id)`,
  ).all(slotId) as { id: string; approver_id: string; version: string; token: string; status: ApprovalItem["status"]; comment: string; requested_at: string; decided_at: string }[];
  const items: ApprovalItem[] = approvers.map((ap) => {
    const r = rows.find((x) => x.approver_id === ap.id);
    return r
      ? { id: r.id, approver_id: ap.id, name: ap.name, role: ap.role, email: ap.email, required: Boolean(ap.required), status: r.status, comment: r.comment, token: r.token, requested_at: r.requested_at, decided_at: r.decided_at, stale: r.version !== version }
      : { id: "", approver_id: ap.id, name: ap.name, role: ap.role, email: ap.email, required: Boolean(ap.required), status: "pending", comment: "", token: "", requested_at: "", decided_at: "", stale: true };
  });
  const current = items.filter((i) => i.id && !i.stale);
  const required = items.filter((i) => i.required);
  const missing = required.filter((i) => !(i.id && !i.stale && i.status === "approved")).map((i) => i.name);
  return {
    approvers: items.length,
    required: required.length,
    approved: current.filter((i) => i.status === "approved").length,
    changes: current.filter((i) => i.status === "changes").length,
    pending: current.filter((i) => i.status === "pending").length,
    requested: current.length > 0,
    ready: missing.length === 0,
    version,
    items,
    missing,
  };
}

/* Ask everyone who hasn't signed off on this exact version. Existing current approvals are kept. */
export function requestApprovals(slotId: string) {
  const db = getDb();
  const s = approvalSummary(slotId);
  let created = 0;
  for (const i of s.items) {
    if (i.id && !i.stale && i.status !== "changes") continue;
    db.prepare("INSERT INTO approvals (id, slot_id, approver_id, version, token, status, comment, requested_at, decided_at) VALUES (?, ?, ?, ?, ?, 'pending', '', ?, '')")
      .run(newId(), slotId, i.approver_id, s.version, crypto.randomBytes(18).toString("base64url"), new Date(Date.now() + created).toISOString());
    created++;
  }
  return { requested: created, summary: approvalSummary(slotId) };
}

export function approvalByToken(token: string) {
  return getDb().prepare(
    `SELECT a.*, ap.name, ap.role FROM approvals a JOIN approvers ap ON ap.id = a.approver_id WHERE a.token = ?`,
  ).get(token) as ({ id: string; slot_id: string; approver_id: string; version: string; status: string; comment: string; decided_at: string; name: string; role: string }) | undefined;
}

export function decide(token: string, status: "approved" | "changes", comment: string) {
  const a = approvalByToken(token);
  if (!a) throw new Error("This review link isn't valid");
  if (a.version !== postVersion(a.slot_id)) throw new Error("This post changed after the link was sent. Ask for a new review link.");
  if (status === "changes" && !comment.trim()) throw new Error("Say what should change");
  getDb().prepare("UPDATE approvals SET status = ?, comment = ?, decided_at = ? WHERE id = ?").run(status, comment.trim().slice(0, 2000), now(), a.id);
  return approvalSummary(a.slot_id);
}

/* Addresses other people on the same Wi-Fi can open (the dev server listens on every interface). */
export function reviewBases(port = Number(process.env.PORT || 3210)) {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push(`http://${n.address}:${port}`);
  }
  return { local: `http://localhost:${port}`, network: out };
}
