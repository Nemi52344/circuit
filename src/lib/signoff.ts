import { can } from "@/lib/auth";
import { createHash } from "node:crypto";
import { getDb, getAccountsDb, now } from "@/lib/db";
import type { User } from "@/lib/auth";

/* Sign-off: somebody who can approve saying a particular post, as written, may go public.

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

/* One post plus its decision, turned into the state the rest of the app reads. Kept apart from
   the queries so the single-post path and the list path cannot drift. */
function derive(r: Row, s: Signoff | undefined): PostState {
  const current = fingerprint(r.caption || "", r.image);
  const stale = Boolean(s && s.decision === "approved" && s.caption_hash !== current);
  const cleared = Boolean(s && s.decision === "approved" && !stale);

  let blocked = "";
  if (!s) blocked = "Waiting to be signed off.";
  else if (s.decision === "rejected") blocked = `Sent back by ${s.by_name}${s.note ? `: ${s.note}` : "."}`;
  else if (stale) blocked = "This was signed off, then edited. It needs signing off again.";

  return { ...r, signoff: s || null, stale, cleared, blocked_reason: blocked };
}

export function stateOf(id: string): PostState | null {
  const r = rowFor(id);
  if (!r) return null;
  const s = getDb().prepare("SELECT * FROM signoffs WHERE post_id = ?").get(id) as Signoff | undefined;
  return derive(r, s);
}

/* Every unpublished post with its decision, in two queries rather than two per post.

   The first version called stateOf in a loop, which is fine at seventeen posts and visibly
   slow at five hundred — and the queue is the one page somebody opens when they are in a
   hurry. The derivation is shared with stateOf so a single post and the whole list can never
   disagree about whether something is cleared. */
function allStates(): PostState[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.id, p.platform, p.caption, p.scheduled_at, p.status, COALESCE(p.file_id, c.file_id) AS image
    FROM posts p LEFT JOIN creations c ON c.id = p.creation_id
    WHERE p.status != 'posted' ORDER BY p.scheduled_at`).all() as Row[];
  const signoffs = new Map(
    (db.prepare("SELECT * FROM signoffs").all() as Signoff[]).map((s) => [s.post_id, s]),
  );
  return rows.map((r) => derive(r, signoffs.get(r.id)));
}

/* Everything waiting to be looked at, plus anything whose approval has gone stale. */
export const waitingForSignoff = (): PostState[] => allStates().filter((s) => !s.cleared);

export const signedOff = (): PostState[] => allStates().filter((s) => s.cleared);

export function decide(postId: string, user: User, decision: Decision, note = ""): PostState {
  if (!can(user, "approve")) throw new Error("Your account cannot sign a post off");
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
  /* Sign-off only means something once somebody can give it. With nobody on the system who can
     approve, the gate would refuse every post forever, which is not safety, it is a locked door
     with the key inside — so an empty user list leaves Circuit behaving as it always has.

     Asked as a capability, and asked of the accounts database.

     It used to count rows in `users` on the brand database where role = 'admin'. Both halves of
     that were wrong by the time anybody noticed. Accounts moved to accounts.db when brands were
     split, and the copy left behind in circuit.db was kept on purpose and never updated again —
     so this was reading a snapshot of who had an account at some point in the past. Then the
     roles were renamed and 'admin' stopped existing, which the stale copy hid, because it still
     said 'admin'. The gate was open or shut according to a table nothing writes to any more.

     Counting what people can do rather than what they are called is also what makes an approver
     count: they are the role that exists to give exactly this, and a check for 'admin' would
     have ignored every one of them. */
  const people = getAccountsDb().prepare("SELECT role FROM users WHERE active = 1").all() as { role: string }[];
  if (!people.some((u) => can(u, "approve"))) return { ok: true, reason: "" };

  const s = stateOf(postId);
  if (!s) return { ok: false, reason: "That post is not here any more" };
  return s.cleared ? { ok: true, reason: "" } : { ok: false, reason: s.blocked_reason };
}
