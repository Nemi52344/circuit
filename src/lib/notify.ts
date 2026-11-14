import { getDb, now, newId } from "@/lib/db";
import { listUsers, type User } from "@/lib/auth";
import { can, type Can } from "@/lib/roles";

/* Telling a person something needs them.

   A notification is a row: who it is for, what happened, and where to go about it. The page
   asks for new ones every few seconds and shows each as a pop-up — inside Circuit always, and
   as a desktop or phone notification when the person has allowed it.

   Two ways in. Things that happen at a moment — work assigned to you — notify as they happen.
   Things that are true for a while — a routine waiting on someone, work due tomorrow — are
   found by the worker's sweep, and the dedupe key makes sure each is said once, not every
   twenty seconds for as long as it stays true. */

export type Note = { id: string; user_id: string; kind: string; title: string; body: string; link: string; created_at: string; read_at: string };

/* To one person, several, or everyone holding a grant. Returns how many were actually new. */
export function notify(to: string | string[] | { can: Can }, n: { kind: string; title: string; body?: string; link?: string; dedupe?: string }): number {
  const users = listUsers().filter((u) => u.active);
  const ids = typeof to === "string" ? [to] : Array.isArray(to) ? to : users.filter((u) => can(u, to.can)).map((u) => u.id);
  const ins = getDb().prepare(`INSERT OR IGNORE INTO notifications (id, user_id, kind, title, body, link, dedupe, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let made = 0;
  for (const id of new Set(ids.filter(Boolean))) {
    made += ins.run(newId(), id, n.kind, n.title.slice(0, 160), (n.body || "").slice(0, 600), n.link || "", n.dedupe || "", now()).changes;
  }
  return made;
}

export function myNotes(user: Pick<User, "id">, opts: { since?: string; limit?: number } = {}): { notes: Note[]; unread: number } {
  const db = getDb();
  const notes = (opts.since
    ? db.prepare("SELECT * FROM notifications WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?").all(user.id, opts.since, opts.limit ?? 30)
    : db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(user.id, opts.limit ?? 30)) as Note[];
  const unread = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at = ''").get(user.id) as { n: number }).n;
  return { notes, unread };
}

export function markRead(user: Pick<User, "id">, ids?: string[]): number {
  const db = getDb();
  if (!ids) return db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at = ''").run(now(), user.id).changes;
  const st = db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at = ''");
  return ids.reduce((n, id) => n + st.run(now(), user.id, id).changes, 0);
}

/* The sweep: things that have become true, each said once. Run by the worker. */
export function sweepNotifications(): number {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let made = 0;

  // a routine has stopped and is waiting for a person
  for (const r of db.prepare(`SELECT r.id, w.name FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.status = 'waiting'`).all() as { id: string; name: string }[]) {
    made += notify({ can: "manage" }, { kind: "routine", title: `${r.name} is waiting for you`, body: "A step needs a person before the routine can carry on.", link: "/automation?tab=workflows", dedupe: `wait:${r.id}` });
  }
  // a routine failed in the last day
  for (const r of db.prepare(`SELECT r.id, w.name FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
                              WHERE r.status = 'failed' AND r.started_at > ?`).all(new Date(Date.now() - 86400000).toISOString()) as { id: string; name: string }[]) {
    made += notify({ can: "manage" }, { kind: "routine", title: `${r.name} failed`, body: "Open Workflows to see which step and why.", link: "/automation?tab=workflows", dedupe: `fail:${r.id}` });
  }
  // work due tomorrow, and work that is late, to whoever has it
  for (const t of db.prepare(`SELECT id, title, assignee_id, end_date FROM tasks
                              WHERE assignee_id <> '' AND status NOT IN ('done', 'dropped') AND end_date <> '' AND end_date <= ?`).all(tomorrow) as { id: string; title: string; assignee_id: string; end_date: string }[]) {
    const late = t.end_date < today;
    made += notify(t.assignee_id, {
      kind: "due", title: late ? `Late: ${t.title}` : t.end_date === today ? `Due today: ${t.title}` : `Due tomorrow: ${t.title}`,
      body: late ? `It was due ${t.end_date}.` : "", link: "/work", dedupe: `${late ? "late" : "due"}:${t.id}:${late ? today : t.end_date}`,
    });
  }
  // the online copy stopped updating
  try {
    const last = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'turso_last'").get() as { value: string } | undefined)?.value || "null") as { ok: boolean; at: string; error?: string } | null;
    if (last && !last.ok) made += notify({ can: "manage" }, { kind: "system", title: "The online copy couldn't update", body: last.error || "", link: "/settings", dedupe: `mirror:${today}` });
  } catch { /* nothing to say */ }
  return made;
}
