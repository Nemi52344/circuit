import { createHash } from "node:crypto";
import { getDb, now } from "@/lib/db";
import type { User } from "@/lib/auth";

/* Sign-off: an admin saying a particular post, as written, may go public.

   The approval is tied to the words, not just the post. A post approved and then edited is not
   an approved post — otherwise sign-off becomes a formality anyone can walk around by getting a
   yes on something harmless and changing it afterwards. So the caption and the picture are
   fingerprinted at the moment of the decision, and if either changes the approval falls away by
   itself and has to be asked for again.

   This matters more than it would elsewhere because publishing cannot be undone. Facebook lets
   a post be deleted through the API; Instagram does not, at all. A post that goes out wrong on
   Instagram stays wrong until somebody removes it by hand. */

export type Decision = "approved" | "rejected";
export type Signoff = {
  post_id: string; decision: Decision; by_user: string; by_name: string;
  note: string; caption_hash: string; decided_at: string;
};
export type PostState = {
  id: string; platform: string; caption: string; scheduled_at: string; status: string;
  image: string | null;
  signoff: Signoff | null;
  /* Separate from signoff being absent: this one WAS approved, and then the words moved. */
  stale: boolean;
  cleared: boolean;
  blocked_reason: string;
};

/* The fingerprint. Caption and picture together: swapping the image under an approved caption
   changes the post just as much as rewriting it. */
export function fingerprint(caption: string, image: string | null): string {
  return createHash("sha256").update(`${caption}\u0000${image || ""}`).digest("hex");
}

type Row = { id: string; platform: string; caption: string; scheduled_at: string; status: string; image: string | null };

const rowFor = (id: string) =>
  getDb().prepare(`
    SELECT p.id, p.platform, p.caption, p.scheduled_at, p.status, COALESCE(p.file_id, c.file_id) AS image
    FROM posts p LEFT JOIN creations c ON c.id = p.creation_id WHERE p.id = ?`).get(id) as Row | undefined;

export function stateOf(id: string): PostState | null {
  const r = rowFor(id);
  if (!r) return null;
  const s = getDb().prepare("SELECT * FROM signoffs WHERE post_id = ?").get(id) as Signoff | undefined;
  const current = fingerprint(r.caption || "", r.image);

  const stale = Boolean(s && s.decision === "approved" && s.caption_hash !== current);
  const cleared = Boolean(s && s.decision === "approved" && !stale);

  let blocked = "";
  if (!s) blocked = "Waiting for an admin to sign this off.";
  else if (s.decision === "rejected") blocked = `Sent back by ${s.by_name}${s.note ? `: ${s.note}` : "."}`;
  else if (stale) blocked = "This was signed off, then edited. It needs signing off again.";

  return { ...r, signoff: s || null, stale, cleared, blocked_reason: blocked };
}

/* Everything an admin has been asked to look at, plus anything whose approval has gone stale. */
export function waitingForSignoff(): PostState[] {
  const ids = getDb().prepare("SELECT id FROM posts WHERE status != 'posted' ORDER BY scheduled_at").all() as { id: string }[];
  return ids.map((r) => stateOf(r.id)).filter((s): s is PostState => Boolean(s) && !s!.cleared);
}

export function signedOff(): PostState[] {
  const ids = getDb().prepare("SELECT id FROM posts WHERE status != 'posted' ORDER BY scheduled_at").all() as { id: string }[];
  return ids.map((r) => stateOf(r.id)).filter((s): s is PostState => Boolean(s) && s!.cleared);
}

export function decide(postId: string, user: User, decision: Decision, note = ""): PostState {
  if (user.role !== "admin") throw new Error("Only an admin can sign a post off");
  const r = rowFor(postId);
  if (!r) throw new Error("That post is not here any more");
  if (r.status === "posted") throw new Error("That one has already gone out");
  if (decision === "rejected" && !note.trim()) {
    /* A rejection without a reason sends the post back to someone who now has to guess what was
       wrong with it, and guessing produces another rejection. */
    throw new Error("Say what needs changing — a rejection without a reason cannot be acted on");
  }

  getDb().prepare(`
    INSERT INTO signoffs (post_id, decision, by_user, by_name, note, caption_hash, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET decision = excluded.decision, by_user = excluded.by_user,
      by_name = excluded.by_name, note = excluded.note, caption_hash = excluded.caption_hash,
      decided_at = excluded.decided_at`)
    .run(postId, decision, user.id, user.name, note.trim(), fingerprint(r.caption || "", r.image), now());

  return stateOf(postId) as PostState;
}

/* The gate itself. Called by anything that is about to make a post public — Circuit's own
   publishing, and the hand-over to Mark alike. There is deliberately no way to publish that
   skips this. */
export function publishAllowed(postId: string): { ok: boolean; reason: string } {
  /* Sign-off only means something once somebody can give it. With no admin on the system the
     gate would refuse every post forever, which is not safety, it is a locked door with the key
     inside — so an empty user list leaves Circuit behaving as it always has. */
  const admins = (getDb().prepare("SELECT count(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as { n: number }).n;
  if (admins === 0) return { ok: true, reason: "" };

  const s = stateOf(postId);
  if (!s) return { ok: false, reason: "That post is not here any more" };
  return s.cleared ? { ok: true, reason: "" } : { ok: false, reason: s.blocked_reason };
}
