import { getDb, getSetting, setSetting, newId, now } from "@/lib/db";

/* Sending mail out of Circuit, through a Zapier hook.

   Circuit runs on a laptop with no mail server and no business of holding a Google password.
   So it posts the message to one Zapier hook the owner sets up — "Catch Hook" into "Gmail:
   Send Email" — and Zapier does the sending from the owner's own account. Circuit never sees
   a credential, and the owner can see, pause or change the Zap at any time.

   Every send is written down here first: what went out, to whom and when. A mail nobody can
   point to afterwards is worse than no mail. */

export type Outgoing = {
  to: string; subject: string; body: string; kind?: string;
  /* The same message in HTML, so the Zap can send the branded version rather than raw text. */
  html?: string;
  /* A file the Zap can attach. It has to be an address on the internet — Zapier cannot reach
     anything on this Mac — which is what the Supabase copy of the PDF is for. */
  attachment_url?: string; attachment_name?: string;
};
export type SentMail = {
  id: string; to_address: string; subject: string; body: string; kind: string;
  status: string; error: string; created_at: string;
};

export const hookUrl = () => getSetting("mail_hook") || "";
export const mailTo = () => getSetting("mail_to") || "";
export const mailOn = () => getSetting("mail_auto") === "on";

export function mailSettings() {
  return { hook: hookUrl(), to: mailTo(), auto: mailOn(), recent: recentMail(8) };
}

export function saveMailSettings(s: { hook?: string | null; to?: string | null; auto?: boolean }) {
  const db = getDb();
  if (s.hook !== undefined) {
    const v = (s.hook || "").trim();
    if (v) setSetting("mail_hook", v); else db.prepare("DELETE FROM settings WHERE key = 'mail_hook'").run();
  }
  if (s.to !== undefined) {
    const v = (s.to || "").trim();
    if (v) setSetting("mail_to", v); else db.prepare("DELETE FROM settings WHERE key = 'mail_to'").run();
  }
  if (s.auto !== undefined) setSetting("mail_auto", s.auto ? "on" : "off");
  return mailSettings();
}

export function recentMail(limit = 12): SentMail[] {
  return getDb().prepare("SELECT * FROM sent_mail ORDER BY created_at DESC LIMIT ?").all(limit) as SentMail[];
}

/* One send. The hook decides what happens next; Circuit only records that it handed it over. */
export async function sendMail(msg: Outgoing): Promise<SentMail> {
  const db = getDb();
  const to = (msg.to || mailTo()).trim();
  const id = newId();
  const row = (status: string, error: string) => {
    db.prepare("INSERT INTO sent_mail (id, to_address, subject, body, kind, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, to, msg.subject.slice(0, 300), msg.body.slice(0, 40000), msg.kind || "note", status, error.slice(0, 400), now());
    return db.prepare("SELECT * FROM sent_mail WHERE id = ?").get(id) as SentMail;
  };

  const hook = hookUrl();
  if (!hook) return row("failed", "No Zapier hook saved yet");
  if (!to) return row("failed", "No address to send to");

  try {
    const r = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* Every field goes out every time, even when empty. Zapier only offers a field for
         mapping if it saw it in the sample, so a field that appears only sometimes is a field
         that silently drops out of the email later. */
      body: JSON.stringify({
        to, subject: msg.subject, body: msg.body,
        html: msg.html || msg.body, body_format: msg.html ? "HTML" : "Text",
        kind: msg.kind || "note",
        attachment_url: msg.attachment_url || "", attachment_name: msg.attachment_name || "",
        sent_at: now(), from_app: "Circuit",
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return row("failed", `The hook answered HTTP ${r.status}`);
    return row("sent", "");
  } catch (e) {
    return row("failed", (e as Error).message);
  }
}
