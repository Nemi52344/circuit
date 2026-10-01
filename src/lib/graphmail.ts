import { getDb, getSetting, setSetting, newId, now } from "@/lib/db";

/* Sending mail with a real attachment, straight from Circuit.

   The Zapier route can carry words but not files: its email step only accepts a file it can
   already reach on the internet, and Circuit's PDFs live on this Mac. Microsoft Graph takes the
   file itself — the bytes, base64, in the same request — so the briefing arrives as a proper
   PDF attachment and nothing has to be hosted anywhere.

   It signs in as the app against the company's own Microsoft 365 tenant (client credentials),
   so it keeps working at 9am whether or not anyone is at the machine. The three values below
   are pasted once by the owner and stay on this Mac. */

export type GraphSettings = { tenant: string; client_id: string; has_secret: boolean; from: string; to: string; ready: boolean };

export const graphTenant = () => getSetting("ms_tenant") || "";
export const graphClientId = () => getSetting("ms_client_id") || "";
const graphSecret = () => getSetting("ms_client_secret") || "";
export const graphFrom = () => getSetting("ms_from") || "";
export const graphTo = () => getSetting("ms_to") || "";

export function graphSettings(): GraphSettings {
  const ready = Boolean(graphTenant() && graphClientId() && graphSecret() && graphFrom());
  return { tenant: graphTenant(), client_id: graphClientId(), has_secret: Boolean(graphSecret()), from: graphFrom(), to: graphTo(), ready };
}

export function saveGraphSettings(s: { tenant?: string | null; client_id?: string | null; client_secret?: string | null; from?: string | null; to?: string | null }) {
  const db = getDb();
  const put = (key: string, v: string | null | undefined) => {
    if (v === undefined) return;
    const val = (v || "").trim();
    if (val) setSetting(key, val); else db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  };
  put("ms_tenant", s.tenant);
  put("ms_client_id", s.client_id);
  put("ms_client_secret", s.client_secret);
  put("ms_from", s.from);
  put("ms_to", s.to);
  return graphSettings();
}

/* A token for the app itself, cached until shortly before it expires. */
let cached: { token: string; until: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.until > Date.now() + 60000) return cached.token;
  const tenant = graphTenant();
  const id = graphClientId();
  const secret = graphSecret();
  if (!tenant || !id || !secret) throw new Error("Microsoft 365 isn't set up yet");
  const body = new URLSearchParams({
    client_id: id, client_secret: secret,
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    signal: AbortSignal.timeout(30000),
  });
  const data = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || `Microsoft refused the sign-in (HTTP ${r.status})`);
  cached = { token: data.access_token, until: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

export type Attachment = { name: string; mime: string; bytes: Buffer };

/* One message. Attachments go inline as base64, which is why this route can send the PDF at
   all. Recipients are split on commas so a briefing can go to a few people. */
export async function sendGraphMail(msg: { to?: string; subject: string; html: string; attachments?: Attachment[]; kind?: string }) {
  const db = getDb();
  const to = (msg.to || graphTo()).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const from = graphFrom();
  const id = newId();
  const log = (status: string, error: string) => {
    db.prepare("INSERT INTO sent_mail (id, to_address, subject, body, kind, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, to.join(", "), msg.subject.slice(0, 300), msg.html.slice(0, 40000), msg.kind || "note", status, error.slice(0, 500), now());
    return db.prepare("SELECT * FROM sent_mail WHERE id = ?").get(id) as { id: string; status: string; error: string; to_address: string; subject: string };
  };

  if (!to.length) return log("failed", "No address to send to");
  if (!from) return log("failed", "No sending mailbox set");

  try {
    const t = await token();
    const payload = {
      message: {
        subject: msg.subject,
        body: { contentType: "HTML", content: msg.html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        attachments: (msg.attachments || []).map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.mime,
          contentBytes: a.bytes.toString("base64"),
        })),
      },
      saveToSentItems: true,
    };
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
    });
    if (r.status === 202) return log("sent", "");
    const text = await r.text();
    return log("failed", `Microsoft answered HTTP ${r.status}: ${text.slice(0, 300)}`);
  } catch (e) {
    return log("failed", (e as Error).message);
  }
}
