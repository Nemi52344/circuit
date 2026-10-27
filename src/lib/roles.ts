/* Who may do what.

   This module is on its own, with no imports, for one reason: it is the only thing standing
   between a viewer and the publish button, and a rule like that should be testable without a
   database, a session or a running app. The test imports this file itself rather than a copy
   of its table — a second copy of a permission matrix stays right for about a month. */

export type Role = "owner" | "manager" | "creator" | "approver" | "viewer";

/* Deliberately few. A permission nobody can explain is a permission somebody will grant by
   accident. */
export type Can =
  | "view"      // read what is here
  | "create"    // make, upload, edit, schedule
  | "approve"   // sign off work, so it may go out
  | "manage"    // settings, connections, routines, bills, the brand itself
  | "finance"   // salaries, opex, the P&L
  | "people";   // accounts and roles

/* Money is its own permission rather than part of "manage". The whiteboard that set out the
   nineteen workstreams boxed manpower, opex and the P&L together and wrote "only for Gowtham"
   beside them: a manager runs the marketing and approves its spend on tools and bills, but
   what each person is paid is not theirs to read. */
const GRANTS: Record<Role, Can[]> = {
  owner: ["view", "create", "approve", "manage", "finance", "people"],
  manager: ["view", "create", "approve", "manage"],
  /* Creator and approver are disjoint on purpose. Publishing cannot be undone — Instagram's
     API has no delete — so the person who made a thing must not also be the only person who
     decided it was ready. A role holding both would quietly be one person again. */
  creator: ["view", "create"],
  approver: ["view", "approve"],
  viewer: ["view"],
};

/* Named for the people who actually hold them. The keys stay as they were so no stored account
   changes; only what the screen calls each one does. */
export const ROLES: { role: Role; label: string; what: string }[] = [
  { role: "owner", label: "Admin", what: "Everything — including salaries, the P&L and who gets an account" },
  { role: "manager", label: "Marketing Manager", what: "Runs the marketing and signs work off — no salaries or P&L, no accounts" },
  { role: "creator", label: "Marketing Executive", what: "Makes and schedules the work, and takes the learning tests — cannot sign off" },
  { role: "approver", label: "Approver", what: "Signs work off — cannot make or upload any of it" },
  { role: "viewer", label: "Viewer", what: "Reads everything, changes nothing" },
];

export const isRole = (v: unknown): v is Role => typeof v === "string" && Object.prototype.hasOwnProperty.call(GRANTS, v);

/* The two roles Circuit shipped with, read as the nearest of the five. An old session or a row
   written before this change keeps the access it had, rather than falling to "viewer" — which
   is what an unrecognised role must otherwise become. */
/* A Map, not an object literal. Looking up "__proto__" on a literal returns Object.prototype,
   which is truthy, so the fallback below was skipped and `can` was handed something that is not
   a role at all — it threw instead of refusing. A refusal that crashes is a 500 where a 403
   belongs, and on this table the failure direction is the whole point. */
const OLD = new Map<string, Role>([["admin", "owner"], ["marketing", "creator"]]);

export const asRole = (v: string): Role => (isRole(v) ? v : OLD.get(v) || "viewer");

/* An unknown role, a missing user and a null all come out the same: allowed nothing. The
   failure direction matters more here than anywhere else in the app. */
export function can(user: { role: string } | null | undefined, what: Can): boolean {
  if (!user || typeof user.role !== "string") return false;
  return GRANTS[asRole(user.role)].includes(what);
}

export const grantsOf = (role: Role): Can[] => [...GRANTS[role]];
