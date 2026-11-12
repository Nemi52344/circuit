import { handleUser, handleCan, ok, bad, readJson } from "@/lib/http";
import { addRequest, readRequest, listRequests, getRequest, reassign, saveProfile, teamPicture, addMember } from "@/lib/inbox";
import { KINDS } from "@/lib/allocate";
import { mailWorkSettings, saveMailWork, checkWorkMail } from "@/lib/mailwork";
import { can } from "@/lib/roles";
import { listTasks } from "@/lib/books";

/* The work inbox. Anyone signed in may hand Circuit a message to turn into work — a request
   reaches whoever it reaches. Moving work between people, and saying who does what, is for
   managers and the Admin. */
export const runtime = "nodejs";

export const GET = handleUser(async (req, user) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const r = getRequest(id);
    return r ? ok(r) : bad("Not found", 404);
  }
  const requests = listRequests(30);
  const ids = new Set(requests.flatMap((r) => { try { return JSON.parse(r.task_ids) as string[]; } catch { return []; } }));
  const tasks = listTasks().filter((t) => ids.has(t.id));
  return ok({ requests, tasks, kinds: KINDS.map((k) => ({ key: k.key, label: k.label })), ...teamPicture(), mail: can(user, "manage") ? mailWorkSettings() : { on: mailWorkSettings().on } });
});

export const POST = handleUser(async (req, user) => {
  const b = await readJson<{ text?: string; sender?: string }>(req);
  const r = addRequest(b.text || "", user, b.sender || "");
  /* Reading can take ChatGPT a minute. The page gets the request back at once and asks again;
     the reading carries on here whether or not anybody is still watching. */
  readRequest(r.id).catch((e: Error) => console.warn(`[inbox] ${r.id}: ${e.message}`));
  return ok(r, 201);
});

export const PATCH = handleCan("manage", async (req, user) => {
  const b = await readJson<{ action?: string; task_id?: string; to?: string; user_id?: string; takes_work?: boolean; kinds?: string[]; notes?: string; id?: string; name?: string; on?: boolean; mailbox?: string; folder?: string }>(req);
  if (b.action === "assign") {
    if (!b.task_id) return bad("task_id required");
    reassign(b.task_id, b.to || "", user);
    return ok({ moved: true });
  }
  if (b.action === "profile") {
    if (!b.user_id) return bad("user_id required");
    saveProfile({ user_id: b.user_id, takes_work: b.takes_work, kinds: b.kinds, notes: b.notes });
    return ok(teamPicture());
  }
  /* Somebody on the team who has no login yet — their work can be shared out today. */
  if (b.action === "member") {
    addMember(b.name || "", b.kinds || []);
    return ok(teamPicture());
  }
  /* Work by email: which mailbox and folder, on or off, and "look now". */
  if (b.action === "mail") {
    return ok(saveMailWork({ on: b.on, mailbox: b.mailbox, folder: b.folder }));
  }
  if (b.action === "mail-check") {
    try { await checkWorkMail(); } catch (e) { return bad((e as Error).message, 502); }
    return ok(mailWorkSettings());
  }
  if (b.action === "retry") {
    if (!b.id) return bad("id required");
    readRequest(b.id).catch(() => null);
    return ok({ retrying: true });
  }
  return bad("Unknown action");
});
