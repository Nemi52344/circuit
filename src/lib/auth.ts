import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getDb, newId, now } from "@/lib/db";

/* Who is using Circuit, and what they are allowed to do.

   Until now Circuit had no idea who was at the keyboard. That was defensible while it only ever
   answered on localhost — the Mac's own login was the door. It stops being defensible the
   moment anything reaches it from outside, and it was already thin: the token in this database
   can publish to a page with 1,618 followers and an Instagram account with 4,841, and the only
   thing standing in front of it was whoever happened to be sitting here.

   Two roles, because that is what the work actually looks like:

     marketing — does everything. Plans, researches, drafts, schedules, puts things in the queue.
     admin     — the same, and signs off. Nothing goes public without an admin saying so.

   The split is not about trust. It is that publishing is irreversible — Instagram's API has no
   delete at all — so the person who wrote a post should not also be the only person who decided
   it was ready. */

export type Role = "admin" | "marketing";
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
  getDb().prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name").all() as User[];

export const anyUsers = (): boolean =>
  ((getDb().prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n) > 0;

export function createUser(u: { name: string; email: string; role: Role; password: string }): User {
  const problem = passwordProblem(u.password);
  if (problem) throw new Error(problem);
  const email = u.email.trim().toLowerCase();
  if (!email) throw new Error("An email is needed — it is how you sign in");
  const db = getDb();
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
  getDb().prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").run(salt, hash(password, salt), id);
  /* Every other session for this person stops working. Changing a password is what somebody
     does when they think it has leaked, and it should end whatever the leak was being used for. */
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function setActive(id: string, active: boolean) {
  const db = getDb();
  if (!active) {
    const admins = db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(id) as { n: number };
    /* Locking out the last admin leaves nobody who can sign anything off, and nobody who can
       undo it. The database would have to be edited by hand to recover. */
    if (admins.n === 0) throw new Error("This is the only admin left — make someone else an admin first");
  }
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function setRole(id: string, role: Role) {
  const db = getDb();
  if (role !== "admin") {
    const admins = db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(id) as { n: number };
    if (admins.n === 0) throw new Error("This is the only admin left — make someone else an admin first");
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

/* ---- signing in ---- */

type Row = User & { pass_salt: string; pass_hash: string };

export function signIn(email: string, password: string): { token: string; user: User } {
  const db = getDb();
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
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
}

export function userForToken(token: string): User | null {
  if (!token) return null;
  const db = getDb();
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

export function sweepSessions(): number {
  return getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(now()).changes;
}
