import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getAccountsDb, newId, now, accountSetting, setAccountSetting, DATA_DIR } from "@/lib/db";

/* Who is using Circuit, and what they are allowed to do.

   Until now Circuit had no idea who was at the keyboard. That was defensible while it only ever
   answered on localhost — this computer's own login was the door. It stops being defensible the
   moment anything reaches it from outside, and it was already thin: the token in this database
   can publish to a page with 1,618 followers and an Instagram account with 4,841, and the only
   thing standing in front of it was whoever happened to be sitting here.

   Five roles, because two could not say the thing the work needed saying:

     owner    — everything, including who else gets an account.
     manager  — everything except handing out accounts.
     creator  — makes the work. Drafts, uploads, schedules, researches. Cannot sign anything off.
     approver — signs work off. Cannot make or upload any of it.
     viewer   — reads. Changes nothing.

   The split is not about trust. It is that publishing is irreversible — Instagram's API has no
   delete at all — so the person who wrote a post should not also be the only person who decided
   it was ready. Creator and approver are deliberately disjoint for that reason: separating them
   is the only thing that makes a sign-off mean anything, and a role that could do both would
   quietly be one person again.

   What a role may do is written once, below, as a set of capabilities. Every check in the app
   asks "can this person approve" rather than "is this person an admin", so adding a role later
   is a line in a table and not a hunt through the codebase for string comparisons. */

/* The permission table lives on its own so it can be tested without a database. Re-exported
   here because every caller already reaches for auth. */
export { ROLES, isRole, asRole, can, grantsOf, type Role, type Can } from "@/lib/roles";
import { isRole as isRoleValue, type Role } from "@/lib/roles";

export type User = { id: string; name: string; email: string; role: Role; active: number; created_at: string };
export type Session = { user: User } | null;

const DAY = 86400000;
const SESSION_DAYS = 30;
export const COOKIE = "circuit_session";

/* ---- passwords ---- */

/* scrypt, with a per-user salt. Deliberately slow: a fast hash is a hash somebody can run
   through a word list. No new dependency — this is all in Node. */
function hash(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function verify(password: string, salt: string, expected: string): boolean {
  const got = Buffer.from(hash(password, salt), "hex");
  const want = Buffer.from(expected, "hex");
  /* Lengths must match before timingSafeEqual, and it is compared in constant time so a wrong
     password does not reveal how much of it was right. */
  return got.length === want.length && timingSafeEqual(got, want);
}

/* Weak passwords are the whole attack. Short is the one rule worth enforcing — the rest of the
   usual advice mostly produces "Password1!" and a sticky note. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters";
  if (/^\d+$/.test(password)) return "Digits alone are too easy to guess";
  return null;
}

/* ---- the people ---- */

export const listUsers = (): User[] =>
  getAccountsDb().prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name").all() as User[];

export const anyUsers = (): boolean =>
  ((getAccountsDb().prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n) > 0;

export function createUser(u: { name: string; email: string; role: Role; password: string }): User {
  const problem = passwordProblem(u.password);
  if (problem) throw new Error(problem);
  const email = u.email.trim().toLowerCase();
  if (!email) throw new Error("An email is needed — it is how you sign in");
  const db = getAccountsDb();
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) throw new Error("Somebody already uses that email");

  const id = newId();
  const salt = randomBytes(16).toString("hex");
  db.prepare(`INSERT INTO users (id, name, email, role, pass_salt, pass_hash, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, u.name.trim() || email, email, u.role, salt, hash(u.password, salt), now());
  return db.prepare("SELECT id, name, email, role, active, created_at FROM users WHERE id = ?").get(id) as User;
}

export function setPassword(id: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16).toString("hex");
  getAccountsDb().prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").run(salt, hash(password, salt), id);
  /* Every other session for this person stops working. Changing a password is what somebody
     does when they think it has leaked, and it should end whatever the leak was being used for. */
  getAccountsDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function setActive(id: string, active: boolean) {
  const db = getAccountsDb();
  /* Locking out the last owner leaves nobody who can hand out accounts, and nobody who can
     undo it. The database would have to be edited by hand to recover. */
  if (!active && lastOwner(id)) throw new Error("This is the only owner left — make someone else an owner first");
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

/* Whether this person is the last one who can hand out accounts. Asked before anything that
   would take that away from them. */
function lastOwner(id: string): boolean {
  const others = getAccountsDb()
    .prepare("SELECT count(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ?")
    .get(id) as { n: number };
  return others.n === 0;
}

export function setRole(id: string, role: Role) {
  if (!isRoleValue(role)) throw new Error("That is not a role Circuit has");
  if (role !== "owner" && lastOwner(id)) throw new Error("This is the only owner left — make someone else an owner first");
  getAccountsDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

/* ---- signing in ---- */

type Row = User & { pass_salt: string; pass_hash: string };

export function signIn(email: string, password: string): { token: string; user: User } {
  const db = getAccountsDb();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
  /* One message for "no such person" and "wrong password" alike. Telling them apart hands an
     outsider a way to find out who has an account here. */
  const wrong = new Error("That email and password do not match");
  if (!row || !row.active) throw wrong;
  if (!verify(password, row.pass_salt, row.pass_hash)) throw wrong;

  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    /* The cookie's value is never stored. Somebody who reads this table still cannot sign in. */
    .run(createHash("sha256").update(token).digest("hex"), row.id, now(), new Date(Date.now() + SESSION_DAYS * DAY).toISOString());

  return { token, user: { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, created_at: row.created_at } };
}

export function signOut(token: string) {
  getAccountsDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
}

export function userForToken(token: string): User | null {
  if (!token) return null;
  const db = getAccountsDb();
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(createHash("sha256").update(token).digest("hex")) as (User & { expires_at: string }) | undefined;
  if (!row || !row.active) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, created_at: row.created_at };
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return userForToken(jar.get(COOKIE)?.value || "");
}

/* Reads the session straight off the request, for the shared route wrapper — which has the
   Request in hand and should not reach for framework globals to get at one cookie. */
export function userForRequest(req: Request): User | null {
  const raw = req.headers.get("cookie") || "";
  const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return userForToken(hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : "");
}

/* ---- locked out ---- */

/* Getting back in when nobody can let you in.

   An admin can already change anyone's password from People, which covers every case but the
   one that actually strands you: you are the only admin and you have forgotten yours. There is
   no email to send a link to — that is the point of a local-first app — so the proof has to be
   something else.

   The proof is the filesystem. Circuit writes a one-time code into data/, and you read it off
   this computer the app is running on. Anyone who can read that file can already read the database
   sitting beside it, so this hands out nothing they did not have; but somebody who merely
   reached the page over the office Wi-Fi cannot see it, and that is the whole distinction.
   The code itself is never stored — only its hash — so the database never holds a live one. */

const RECOVERY_MINUTES = 15;
const RECOVERY_TRIES = 5;
/* No I, O, 0 or 1: this gets copied by hand off a screen, and those four are where that goes
   wrong. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const recoveryFile = () => path.join(DATA_DIR, "recovery-code.txt");

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function clearRecovery() {
  for (const k of ["recovery_user", "recovery_hash", "recovery_until", "recovery_tries"]) setAccountSetting(k, "");
  try { fs.rmSync(recoveryFile(), { force: true }); } catch { /* already gone is fine */ }
}

/* Returns whether a code was actually written. The route deliberately answers the same either
   way, so this cannot be used from the network to find out who has an account. */
export function requestRecovery(email: string): boolean {
  const row = getAccountsDb()
    .prepare("SELECT id, name, email FROM users WHERE email = ? AND active = 1")
    .get(email.trim().toLowerCase()) as { id: string; name: string; email: string } | undefined;
  if (!row) return false;

  const code = Array.from(randomBytes(12))
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");

  const until = new Date(Date.now() + RECOVERY_MINUTES * 60000).toISOString();
  setAccountSetting("recovery_user", row.id);
  setAccountSetting("recovery_hash", sha(code));
  setAccountSetting("recovery_until", until);
  setAccountSetting("recovery_tries", "0");

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    recoveryFile(),
    [
      "Circuit — password recovery",
      "",
      `Account:  ${row.name} <${row.email}>`,
      `Code:     ${code}`,
      `Expires:  ${new Date(until).toLocaleString()} (${RECOVERY_MINUTES} minutes from when you asked)`,
      "",
      "Type this code on the sign-in screen with your new password.",
      "It works once. This file is deleted the moment it is used, and you can",
      "delete it yourself at any time to cancel the reset.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  /* Also on the terminal running the app, so you do not have to go hunting for the file. */
  console.log(`\n[circuit] Password recovery code for ${row.email}: ${code}\n[circuit] Also written to ${recoveryFile()}\n`);
  return true;
}

export function completeRecovery(email: string, code: string, password: string): User {
  const userId = accountSetting("recovery_user") || "";
  const hash = accountSetting("recovery_hash") || "";
  const until = accountSetting("recovery_until") || "";
  const tries = Number(accountSetting("recovery_tries") || "0");

  const stale = new Error("That code is not valid any more. Ask for a new one.");
  if (!userId || !hash || !until) throw stale;
  if (until < now()) { clearRecovery(); throw stale; }
  if (tries >= RECOVERY_TRIES) { clearRecovery(); throw new Error("Too many wrong codes. Ask for a new one."); }

  const row = getAccountsDb()
    .prepare("SELECT id, name, email, role, active, created_at FROM users WHERE id = ?")
    .get(userId) as User | undefined;
  /* The email is checked too, so a code meant for one account cannot reset another. */
  if (!row || row.email !== email.trim().toLowerCase()) {
    setAccountSetting("recovery_tries", String(tries + 1));
    throw new Error("That code does not match this email.");
  }

  const got = Buffer.from(sha(code.trim().toUpperCase()), "hex");
  const want = Buffer.from(hash, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    setAccountSetting("recovery_tries", String(tries + 1));
    const left = RECOVERY_TRIES - (tries + 1);
    throw new Error(left > 0 ? `That code is wrong. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Ask for a new one.");
  }

  /* setPassword applies the length rule and ends every existing session for this account. */
  setPassword(row.id, password);
  clearRecovery();
  return row;
}

export function sweepSessions(): number {
  return getAccountsDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(now()).changes;
}
