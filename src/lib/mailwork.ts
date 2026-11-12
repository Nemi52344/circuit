import { getDb, getSetting, setSetting, now } from "@/lib/db";
import { GRAPH, graphToken, graphCredsReady, graphFrom } from "@/lib/graphmail";
import { addRequest } from "@/lib/inbox";
import { userError } from "@/lib/http";

/* Work that arrives by email.

   Circuit reads one folder of one Outlook mailbox — "Circuit" unless you name another — and
   each new message there becomes a request on the Work page, read into tasks and given out
   exactly like a pasted message. It reads only: nothing in the mailbox is moved, marked or
   deleted, and it never looks at mail from before the folder was connected.

   One folder rather than the whole inbox on purpose. An inbox is mostly not work; a folder is
   what somebody decided is work — by forwarding it there, or by an Outlook rule ("anything
   from the sales head goes to Circuit"). That keeps the decision with a person.

   It uses the same Microsoft 365 app as the briefing mail (Settings → Sending mail), which
   needs one more permission for this: Mail.Read, as an application permission, granted by an
   admin. Mail.Read lets an app read every mailbox in the company unless IT limits it, so the
   setup asks IT to restrict the app to this one mailbox. */

export type MailWork = {
  on: boolean; mailbox: string; folder: string; creds: boolean; since: string;
  last: { at: string; ok: boolean; found: number; error?: string } | null;
};

const EVERY_MS = 5 * 60 * 1000;

export function mailWorkSettings(): MailWork {
  let last: MailWork["last"] = null;
  try { last = JSON.parse(getSetting("work_mail_last") || "null"); } catch { /* none */ }
  return {
    on: getSetting("work_mail_on") === "1",
    mailbox: getSetting("work_mail_box") || graphFrom(),
    folder: getSetting("work_mail_folder") || "Circuit",
    creds: graphCredsReady(),
    since: getSetting("work_mail_since") || "",
    last,
  };
}

export function saveMailWork(s: { on?: boolean; mailbox?: string; folder?: string }): MailWork {
  if (s.mailbox !== undefined) {
    const m = s.mailbox.trim().toLowerCase();
    if (m && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) throw userError("That mailbox doesn't look like an email address");
    setSetting("work_mail_box", m);
  }
  if (s.folder !== undefined) setSetting("work_mail_folder", s.folder.trim().slice(0, 80) || "Circuit");
  if (s.on !== undefined) {
    if (s.on && !graphCredsReady()) throw userError("Connect Microsoft 365 first — Settings → Sending mail");
    /* Turning it on starts from now: the folder's history is not suddenly work. */
    if (s.on && getSetting("work_mail_on") !== "1") setSetting("work_mail_since", now());
    setSetting("work_mail_on", s.on ? "1" : "0");
  }
  return mailWorkSettings();
}

export const mailWorkDue = (): boolean => {
  const s = mailWorkSettings();
  return s.on && s.creds && (!s.last || Date.now() - new Date(s.last.at).getTime() > EVERY_MS);
};

type GraphMessage = {
  id: string; subject?: string; receivedDateTime: string; bodyPreview?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { contentType?: string; content?: string };
};

async function graph<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${GRAPH}/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
    signal: AbortSignal.timeout(30000),
  }).catch((e: Error) => { throw new Error(`Couldn't reach Microsoft: ${e.message}`); });
  if (r.status === 403) throw new Error("Microsoft refused: the app needs the Mail.Read application permission, with admin consent, for this mailbox");
  if (r.status === 404) throw new Error("Microsoft can't find that mailbox or folder");
  if (!r.ok) throw new Error(`Microsoft answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

/* The folder, by its name as it appears in Outlook. "Inbox" is Outlook's own; anything else is
   looked for at the top level and then one level under the inbox, where rules usually put it. */
async function folderId(mailbox: string, name: string, token: string): Promise<string> {
  if (name.trim().toLowerCase() === "inbox") return "inbox";
  const q = encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`);
  const top = await graph<{ value: { id: string }[] }>(`/users/${encodeURIComponent(mailbox)}/mailFolders?$filter=${q}`, token);
  if (top.value[0]) return top.value[0].id;
  const under = await graph<{ value: { id: string }[] }>(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/childFolders?$filter=${q}`, token);
  if (under.value[0]) return under.value[0].id;
  throw new Error(`There's no folder called "${name}" in ${mailbox} — make it in Outlook, or pick another`);
}

/* Plain text from the message, without the quoted thread and signature under it — the request
   is what was written now, not the five replies below. */
export function messageText(m: GraphMessage): string {
  let text = (m.body?.content || m.bodyPreview || "").replace(/\r/g, "");
  if (m.body?.contentType?.toLowerCase() === "html") text = text.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
  /* Numbered characters — ₹ arrives as &#8377; — after &amp;, so "&amp;#8377;" becomes ₹ too. */
  text = text.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
  const cut = text.search(/\n(-{2,}\s*Original Message|_{5,}|From: .+\n(Sent|Date): |On .+wrote:)/i);
  if (cut > 0) text = text.slice(0, cut);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/* One look at the folder: every message since the last one taken becomes a request. Reading
   them into tasks is the worker's next step (unreadRequests), so a burst of mail cannot hold
   up this check behind ChatGPT. */
export async function checkWorkMail(): Promise<{ found: number }> {
  const s = mailWorkSettings();
  const record = (r: { ok: boolean; found: number; error?: string }) => setSetting("work_mail_last", JSON.stringify({ at: now(), ...r }));
  try {
    if (!s.creds) throw new Error("Microsoft 365 isn't connected — Settings → Sending mail");
    if (!s.mailbox) throw new Error("Say which mailbox to read");
    const token = await graphToken();
    const id = await folderId(s.mailbox, s.folder, token);
    const since = s.since || now();
    const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
    const page = await graph<{ value: GraphMessage[] }>(
      `/users/${encodeURIComponent(s.mailbox)}/mailFolders/${encodeURIComponent(id)}/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,body`,
      token,
    );
    const db = getDb();
    const seen = db.prepare("SELECT 1 FROM requests WHERE source = 'mail' AND external_id = ?");
    let found = 0;
    let newest = since;
    for (const m of page.value) {
      if (m.receivedDateTime > newest) newest = m.receivedDateTime;
      if (seen.get(m.id)) continue;
      const fromAddr = (m.from?.emailAddress?.address || "").toLowerCase();
      if (fromAddr && fromAddr === s.mailbox) continue; // Circuit's own mail, or a note to self
      const subject = (m.subject || "").trim();
      const body = messageText(m);
      const text = [subject, body].filter(Boolean).join("\n\n").slice(0, 19000);
      if (text.length < 4) continue;
      const sender = [m.from?.emailAddress?.name, fromAddr && `<${fromAddr}>`].filter(Boolean).join(" ");
      addRequest(text, null, sender, "mail", { subject: subject || body.split("\n")[0], external_id: m.id });
      found++;
    }
    if (newest !== since) setSetting("work_mail_since", newest);
    record({ ok: true, found });
    return { found };
  } catch (e) {
    record({ ok: false, found: 0, error: (e as Error).message });
    throw e;
  }
}
