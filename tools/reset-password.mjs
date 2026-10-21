/* Set a new password for a Circuit account, from this Mac.

   There is no "forgot password" email in Circuit and there should not be: the whole point of a
   local-first app is that no server holds your account. The recovery path is that you are
   sitting at the machine with the database on it, which is proof enough.

   Stored passwords are scrypt hashes with a per-user salt, so the old one cannot be read back
   by anyone — this replaces it rather than revealing it. Every existing session for that
   account is dropped at the same time, which is what you want if you are resetting because you
   think somebody else has it.

   Usage, from the project root:
     node tools/reset-password.mjs prasanth.r@bncmotors.in 'your new password'

   Put the password in single quotes so the shell leaves it alone.
*/

import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const [, , emailArg, passwordArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error("Usage: node tools/reset-password.mjs <email> '<new password>'");
  process.exit(1);
}

/* The same two rules the app applies, so a password set here is one the app would have let you
   choose. Length is the only one worth enforcing; the rest of the usual advice mostly produces
   "Password1!" and a sticky note. */
if (passwordArg.length < 10) {
  console.error("That password is too short — use at least 10 characters.");
  process.exit(1);
}
if (/^\d+$/.test(passwordArg)) {
  console.error("Digits alone are too easy to guess — add some words.");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const db = new Database(path.join(process.cwd(), "data", "circuit.db"));

const user = db.prepare("SELECT id, name, email, role FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`No account here uses ${email}. The accounts on this machine are:`);
  for (const u of db.prepare("SELECT email, role FROM users ORDER BY created_at").all()) {
    console.error(`  ${u.email}  (${u.role})`);
  }
  process.exit(1);
}

/* A fresh salt every time, so two accounts with the same password never share a hash. */
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(passwordArg, salt, 64).toString("hex");

db.prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").run(salt, hash, user.id);
const dropped = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id).changes;

console.log(`Password changed for ${user.name} <${user.email}> (${user.role}).`);
console.log(
  dropped
    ? `${dropped} existing session${dropped === 1 ? "" : "s"} signed out — sign in again with the new password.`
    : "No active sessions to sign out.",
);
