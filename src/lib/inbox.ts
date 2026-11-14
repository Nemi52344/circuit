import { getDb, now, newId } from "@/lib/db";
import { userError } from "@/lib/http";
import { listUsers, type User } from "@/lib/auth";
import { can } from "@/lib/roles";
import { saveTask, type Task } from "@/lib/books";
import { runChatGptJson, codexPath } from "@/lib/chatgpt";
import { notify } from "@/lib/notify";
import {
  pick, pickForJob, rank, mentioned, ANY, cleanExtraction, fallbackExtraction, extractionPrompt, guessKind, kindLabel, isKind,
  type Person, type Signals, type Extracted, type Choice,
} from "@/lib/allocate";

/* The work inbox: a message in, tasks out, each with a person and a reason.

   A message is kept as it arrived (requests), then read — by ChatGPT when it is available, by
   a plain rule when it is not, so a pasted message never just sits there — into tasks on the
   Work board. Each task is given to the person lib/allocate.ts ranks first, and that person
   gets a pop-up. When a manager moves a task to someone else, the move is written down
   (assign_moves); that is what the next ranking learns from. */

export type Request = {
  id: string; source: string; sender: string; subject: string; body: string; created_by: string;
  status: "new" | "reading" | "done" | "nothing" | "failed"; error: string; task_ids: string; created_at: string; updated_at: string;
};
export type Profile = { user_id: string; name: string; login: boolean; takes_work: boolean; kinds: string[]; notes: string };

/* ---- who takes work, and what each is known for ----

   Two kinds of people take work. Those with a login, whose tasks reach them as pop-ups. And
   team members who have no login yet — "member:Gowtham" — so the work can be shared out today
   rather than after somebody gets round to making an account. The moment an account with that
   first name exists, the member's tasks, history and profile move onto it (linkMembers). */

const MEMBER = "member:";
export const isMember = (id: string) => id.startsWith(MEMBER);
const keepKinds = (l: string[]) => l.filter((k) => isKind(k) || k === ANY);

export function profiles(): Profile[] {
  linkMembers();
  const rows = getDb().prepare("SELECT user_id, takes_work, kinds, notes FROM work_profiles").all() as { user_id: string; takes_work: number; kinds: string; notes: string }[];
  const saved = new Map(rows.map((r) => [r.user_id, r]));
  const accounts = listUsers().filter((u) => u.active && can(u, "create")).map((u) => {
    const r = saved.get(u.id);
    /* Until somebody says otherwise, the people who make the work take it, and the Admin
       account — which hands it out — does not. */
    return {
      user_id: u.id, name: u.name, login: true,
      takes_work: r ? Boolean(r.takes_work) : !can(u, "people"),
      kinds: r ? keepKinds(safeList(r.kinds)) : [],
      notes: r?.notes || "",
    };
  });
  const members = rows.filter((r) => isMember(r.user_id)).map((r) => ({
    user_id: r.user_id, name: r.user_id.slice(MEMBER.length), login: false,
    takes_work: Boolean(r.takes_work), kinds: keepKinds(safeList(r.kinds)), notes: r.notes,
  }));
  return [...accounts, ...members];
}

export function addMember(name: string, kinds: string[] = []): Profile[] {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (clean.length < 2) throw userError("Give them a name");
  if (profiles().some((p) => p.name.toLowerCase() === clean.toLowerCase() || p.name.split(" ")[0].toLowerCase() === clean.toLowerCase())) throw userError(`${clean} is already on the team`);
  getDb().prepare("INSERT INTO work_profiles (user_id, takes_work, kinds, notes, updated_at) VALUES (?, 1, ?, '', ?)")
    .run(MEMBER + clean, JSON.stringify(keepKinds(kinds)), now());
  return profiles();
}

/* A member who now has an account: everything that was theirs becomes the account's. Matched
   on first name, the way people are named on a whiteboard. */
function linkMembers() {
  const db = getDb();
  const members = db.prepare("SELECT user_id FROM work_profiles WHERE user_id LIKE 'member:%'").all() as { user_id: string }[];
  if (!members.length) return;
  const users = listUsers().filter((u) => u.active && can(u, "create"));
  for (const m of members) {
    const want = m.user_id.slice(MEMBER.length).toLowerCase();
    const u = users.find((x) => x.name.trim().toLowerCase() === want || x.name.trim().split(/\s+/)[0].toLowerCase() === want);
    if (!u) continue;
    db.transaction(() => {
      db.prepare("UPDATE tasks SET assignee_id = ?, owner = ? WHERE assignee_id = ?").run(u.id, u.name, m.user_id);
      db.prepare("UPDATE assign_moves SET to_user = ? WHERE to_user = ?").run(u.id, m.user_id);
      db.prepare("UPDATE assign_moves SET from_user = ? WHERE from_user = ?").run(u.id, m.user_id);
      if (db.prepare("SELECT 1 FROM work_profiles WHERE user_id = ?").get(u.id)) db.prepare("DELETE FROM work_profiles WHERE user_id = ?").run(m.user_id);
      else db.prepare("UPDATE work_profiles SET user_id = ? WHERE user_id = ?").run(u.id, m.user_id);
    })();
    console.log(`[inbox] ${m.user_id} now has an account — their work moved to ${u.name}`);
  }
}

export function saveProfile(p: { user_id: string; takes_work?: boolean; kinds?: string[]; notes?: string }): Profile[] {
  const cur = profiles().find((x) => x.user_id === p.user_id);
  if (!cur) throw userError("That person can't take work — they need a role that makes things");
  getDb().prepare(`INSERT INTO work_profiles (user_id, takes_work, kinds, notes, updated_at) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET takes_work = excluded.takes_work, kinds = excluded.kinds, notes = excluded.notes, updated_at = excluded.updated_at`)
    .run(p.user_id, (p.takes_work ?? cur.takes_work) ? 1 : 0, JSON.stringify(keepKinds(p.kinds ?? cur.kinds)), (p.notes ?? cur.notes).slice(0, 300), now());
  return profiles();
}

const safeList = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

/* Pop-ups go to people who can sign in; a member without a login has nowhere to see them. */
const tell = (id: string, n: Parameters<typeof notify>[1]) => { if (!isMember(id)) notify(id, n); };

export function people(): Person[] {
  return profiles().map((p) => ({ id: p.user_id, name: p.name, email: "", takes_work: p.takes_work, kinds: p.kinds }));
}

/* What the ranking learns from, read fresh each time: it is a few hundred rows at most. */
export function signals(): Signals {
  const db = getDb();
  const s: Signals = { done: {}, movedTo: {}, movedFrom: {}, open: {} };
  const bump = (m: Signals["done"], id: string, kind: string, n = 1) => { if (!id) return; (m[id] ??= {})[kind] = (m[id][kind] || 0) + n; };
  for (const r of db.prepare("SELECT assignee_id, kind, title, notes, status FROM tasks WHERE assignee_id <> ''").all() as { assignee_id: string; kind: string; title: string; notes: string; status: string }[]) {
    const kind = r.kind || guessKind(`${r.title} ${r.notes}`);
    if (r.status === "done") bump(s.done, r.assignee_id, kind);
    else s.open[r.assignee_id] = (s.open[r.assignee_id] || 0) + 1;
  }
  for (const m of db.prepare("SELECT kind, from_user, to_user FROM assign_moves").all() as { kind: string; from_user: string; to_user: string }[]) {
    bump(s.movedTo, m.to_user, m.kind);
    bump(s.movedFrom, m.from_user, m.kind);
  }
  return s;
}

/* ---- a message in ---- */

export function addRequest(body: string, by: Pick<User, "id"> | null, sender = "", source = "paste", extra: { subject?: string; external_id?: string } = {}): Request {
  const text = body.trim();
  if (text.length < 4) throw userError("Paste the message first");
  if (text.length > 20000) throw userError("That is longer than a message — paste the part with the request in it");
  const id = newId();
  const at = now();
  getDb().prepare(`INSERT INTO requests (id, source, sender, subject, body, created_by, status, external_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`)
    .run(id, source, sender.trim().slice(0, 120), (extra.subject || text.split(/\r?\n/)[0]).slice(0, 120), text, by?.id || "", extra.external_id || "", at, at);
  return getRequest(id)!;
}

/* Requests nobody has read yet — mail that arrived while ChatGPT was busy, or while this computer was
   off. The worker reads them one at a time, oldest first. */
export const unreadRequests = (limit = 3) =>
  getDb().prepare("SELECT * FROM requests WHERE status = 'new' ORDER BY created_at LIMIT ?").all(limit) as Request[];

export const getRequest = (id: string) => getDb().prepare("SELECT * FROM requests WHERE id = ?").get(id) as Request | undefined;
export const listRequests = (limit = 30) => getDb().prepare("SELECT * FROM requests ORDER BY created_at DESC LIMIT ?").all(limit) as Request[];

const reading = new Set<string>();

/* Reads one request into tasks. Safe to call twice: a request already read is left alone. */
export async function readRequest(id: string): Promise<Request> {
  const req = getRequest(id);
  if (!req) throw new Error("That request is not here any more");
  if (req.status !== "new" && req.status !== "failed") return req;
  if (reading.has(id)) return req;
  reading.add(id);
  const db = getDb();
  const set = (status: Request["status"], extra: { error?: string; task_ids?: string[] } = {}) =>
    db.prepare("UPDATE requests SET status = ?, error = ?, task_ids = COALESCE(?, task_ids), updated_at = ? WHERE id = ?")
      .run(status, extra.error || "", extra.task_ids ? JSON.stringify(extra.task_ids) : null, now(), id);
  try {
    set("reading");
    const team = people();
    const today = new Date().toISOString().slice(0, 10);
    let items: Extracted[];
    let how = "ChatGPT";
    if (codexPath()) {
      try {
        const raw = await runChatGptJson(extractionPrompt(req.body, req.sender, today, team.map((p) => p.name)), { search: false, timeoutMs: 4 * 60 * 1000, retryOnTimeout: false });
        items = cleanExtraction(raw, today);
      } catch (e) {
        console.warn(`[inbox] ChatGPT could not read request ${id}: ${(e as Error).message}`);
        items = fallbackExtraction(req.body);
        how = "the plain rule (ChatGPT was not available)";
      }
    } else {
      items = fallbackExtraction(req.body);
      how = "the plain rule (ChatGPT is not installed)";
    }
    if (!items.length) { set("nothing"); return getRequest(id)!; }

    const made: Task[] = [];
    /* Tasks that ChatGPT says are parts of one job are decided together, once, so the whole job
       goes to one person (allocate.ts, pickForJob). */
    const jobs = new Map<string, Extracted[]>();
    for (const it of items) if (it.job) jobs.set(it.job, [...(jobs.get(it.job) || []), it]);
    const decided = new Map<string, { choice: Choice | null; reason: string }>();
    for (const it of items) {
      const sig = signals();
      /* "for_person" is ChatGPT's reading of who the message names; the names found in the text
         itself count too, so a message that says "Gowtham please…" is not left to ChatGPT. */
      const namedIn = (x: Extracted) => [...new Set([...mentioned(`${x.for_person} ${x.title} ${x.details}`, team), ...mentioned(req.body, team).filter(() => items.length === 1)])];
      const named = namedIn(it);
      const parts = it.job ? jobs.get(it.job) || [] : [];
      let pickd: { choice: Choice | null; reason: string };
      if (parts.length > 1) {
        if (!decided.has(it.job)) {
          const p = pickForJob(parts.map((x) => x.kind), team, sig, [...new Set(parts.flatMap(namedIn))]);
          decided.set(it.job, { choice: p.choice, reason: p.choice ? `${p.reason} · keeps the whole "${it.job}" job with one person` : p.reason });
        }
        pickd = decided.get(it.job)!;
      } else {
        pickd = pick(it.kind, team, sig, named);
      }
      const { choice, reason } = pickd;
      const due = it.due || new Date(Date.now() + (it.priority === "high" ? 1 : 7) * 86400000).toISOString().slice(0, 10);
      const task = saveTask({
        title: it.title, notes: [it.details, req.sender ? `From: ${req.sender}` : ""].filter(Boolean).join("\n\n"),
        owner: choice?.name || "", area: "marketing", start_date: today, end_date: due, status: "planned", doable_by: "person",
      });
      db.prepare("UPDATE tasks SET assignee_id = ?, kind = ?, request_id = ?, assign_reason = ?, priority = ? WHERE id = ?")
        .run(choice?.id || "", it.kind, id, `${reason} · read by ${how}`, it.priority, task.id);
      made.push(task);
      if (choice) {
        tell(choice.id, { kind: "assigned", title: `New ${it.priority === "high" ? "urgent " : ""}work for you: ${it.title}`, body: `${kindLabel(it.kind)} · due ${due}${req.sender ? ` · from ${req.sender}` : ""}`, link: "/work", dedupe: `assign:${task.id}` });
      }
    }
    set("done", { task_ids: made.map((t) => t.id) });
    if (req.created_by) {
      const who = made.map((t) => (db.prepare("SELECT owner FROM tasks WHERE id = ?").get(t.id) as { owner: string }).owner || "nobody").join(", ");
      notify(req.created_by, { kind: "inbox", title: `Your message became ${made.length} task${made.length === 1 ? "" : "s"}`, body: `Given to ${who}.`, link: "/work", dedupe: `read:${id}` });
    }
    return getRequest(id)!;
  } catch (e) {
    set("failed", { error: (e as Error).message });
    throw e;
  } finally {
    reading.delete(id);
  }
}

/* ---- a manager moves a task ---- */

export function reassign(taskId: string, toUser: string, by: User): void {
  const db = getDb();
  const t = db.prepare("SELECT id, title, kind, notes, assignee_id, end_date FROM tasks WHERE id = ?").get(taskId) as { id: string; title: string; kind: string; notes: string; assignee_id: string; end_date: string } | undefined;
  if (!t) throw userError("That task is not here any more");
  const team = people();
  const to = team.find((p) => p.id === toUser);
  if (toUser && !to) throw userError("That person can't take work");
  if (t.assignee_id === toUser) return;
  const kind = t.kind || guessKind(`${t.title} ${t.notes}`);
  db.prepare("UPDATE tasks SET assignee_id = ?, owner = ?, kind = ?, assign_reason = ?, updated_at = ? WHERE id = ?")
    .run(toUser, to?.name || "", kind, toUser ? `Given to ${to!.name} by ${by.name}` : `Taken off by ${by.name}`, now(), taskId);
  /* The lesson. Only a move between two people teaches anything about who does what kind of
     work; picking up an unassigned task is just picking it up. */
  if (toUser) {
    db.prepare("INSERT INTO assign_moves (id, task_id, kind, from_user, to_user, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId(), taskId, kind, t.assignee_id, toUser, by.id, now());
    if (toUser !== by.id) tell(toUser, { kind: "assigned", title: `${by.name} gave you: ${t.title}`, body: t.end_date ? `Due ${t.end_date}` : "", link: "/work", dedupe: `move:${taskId}:${toUser}:${Date.now()}` });
  }
}

/* For the Inbox page: each person, what they are known for, and how a kind would go now. */
export function teamPicture(): { people: (Profile & { done: Record<string, number>; open: number })[]; preview: { kind: string; label: string; ranked: Choice[] }[] } {
  const sig = signals();
  const team = people();
  return {
    people: profiles().map((p) => ({ ...p, done: (sig.done[p.user_id] || {}) as Record<string, number>, open: sig.open[p.user_id] || 0 })),
    preview: ["social_post", "poster", "video", "event", "vendor", "report"].map((k) => ({ kind: k, label: kindLabel(k), ranked: rank(k, team, sig).slice(0, 3) })),
  };
}

/* ---- a quick list straight onto the board ----

   "1) My blog post 2) Battery deck…" typed or pasted into the Work page. No ChatGPT: each line
   is already a task, so it is read by the plain rule and given out at once — or to whoever the
   person picked. Numbering and bullets are taken off. */
export function quickAdd(text: string, by: User, opts: { assignee?: string; due?: string; priority?: string } = {}): Task[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(\(?\d{1,3}[).:]|[-*•·]|\[\s?\])\s*/, "").trim()).filter((l) => l.length > 1).slice(0, 40);
  if (!lines.length) throw userError("Type what needs doing");
  const team = people();
  const today = new Date().toISOString().slice(0, 10);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(opts.due || "") ? opts.due! : today;
  const priority = opts.priority === "high" ? "high" : "normal";
  const chosen = opts.assignee && opts.assignee !== "auto" ? team.find((p) => p.id === opts.assignee) : undefined;
  if (opts.assignee && opts.assignee !== "auto" && !chosen) throw userError("That person isn't on the team");
  const db = getDb();
  const made: Task[] = [];
  for (const title of lines) {
    const kind = guessKind(title);
    const named = mentioned(title, team);
    const { choice, reason } = chosen ? { choice: { id: chosen.id, name: chosen.name }, reason: `Given to ${chosen.name} by ${by.name}` } : pick(kind, team, signals(), named);
    const t = saveTask({ title: title.slice(0, 140), owner: choice?.name || "", area: "marketing", start_date: today < due ? today : due, end_date: due, status: "planned", doable_by: "person" });
    db.prepare("UPDATE tasks SET assignee_id = ?, kind = ?, assign_reason = ?, priority = ? WHERE id = ?").run(choice?.id || "", kind, reason, priority, t.id);
    if (choice && choice.id !== by.id) tell(choice.id, { kind: "assigned", title: `New work for you: ${title.slice(0, 100)}`, body: `${kindLabel(kind)} · due ${due} · from ${by.name}`, link: "/work", dedupe: `assign:${t.id}` });
    made.push(db.prepare("SELECT * FROM tasks WHERE id = ?").get(t.id) as Task);
  }
  return made;
}
