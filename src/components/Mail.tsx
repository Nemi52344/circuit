"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDate } from "@/lib/api";
import { Pill } from "@/components/ui";

/* Sending mail out of Circuit through one Zapier hook the owner sets up. Circuit never holds
   a mail password: it posts the message to the hook, and Zapier sends it from the owner's own
   Gmail. Every send is written down, including the ones that failed. */

type Sent = { id: string; to_address: string; subject: string; kind: string; status: string; error: string; created_at: string };
type Graph = { tenant: string; client_id: string; has_secret: boolean; from: string; to: string; ready: boolean };
type Supa = { url: string; bucket: string; table: string; has_key: boolean; ready: boolean; sql?: string };
type Settings = { hook: string; to: string; auto: boolean; recent: Sent[]; graph?: Graph; supabase?: Supa };

/* Two panels from one component: "mail" is how mail goes out, "archive" is the Supabase copy of
   the briefings. They share one settings record, so each just loads it for itself. */
export function MailPanel({ push, part = "mail" }: { push: (t: string, tone?: string) => void; part?: "mail" | "archive" }) {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api<Settings>("/api/mail").then(setS).catch(() => null), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const hook = (document.getElementById("mail-hook") as HTMLInputElement)?.value ?? "";
    const to = (document.getElementById("mail-to") as HTMLInputElement)?.value ?? "";
    setBusy("save");
    try {
      setS(await postJson<Settings>("/api/mail", { action: "save", hook, to }));
      push("Saved", "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  const saveGraph = async () => {
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    setBusy("graph");
    try {
      setS(await postJson<Settings>("/api/mail", {
        action: "graph", tenant: get("ms-tenant"), client_id: get("ms-client"),
        /* A blank secret box means "leave the saved one alone" — otherwise every small edit
           elsewhere on the panel would quietly wipe a secret nobody retyped. */
        client_secret: get("ms-secret") || undefined, from: get("ms-from"), to: get("ms-to"),
      }));
      push("Saved", "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  const testGraph = async () => {
    setBusy("graphtest");
    try {
      await postJson("/api/mail", { action: "graphtest" });
      push("Sent with the latest briefing attached — check your inbox", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
      load();
    } finally {
      setBusy("");
    }
  };

  const saveSupabase = async () => {
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    setBusy("sb");
    try {
      setS(await postJson<Settings>("/api/mail", { action: "supabase", url: get("sb-url"), key: get("sb-key") || undefined, bucket: get("sb-bucket"), table: get("sb-table") }));
      push("Saved", "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  const testSupabase = async () => {
    setBusy("sbtest");
    try {
      const r = await postJson<{ created: boolean }>("/api/mail", { action: "sbtest" });
      push(r.created ? "Bucket created and ready" : "Bucket is there and readable", "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await postJson("/api/mail", { action: "test" });
      push("Sent — check your inbox", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
      load();
    } finally {
      setBusy("");
    }
  };

  if (!s) return null;
  const ready = Boolean(s.hook && s.to);

  if (part === "archive") return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Briefing archive <span className="muted">· Supabase</span></h3>
        <Pill tone={s.supabase?.ready ? "ok" : "warn"}>{s.supabase?.ready ? "Connected" : "Not set up"}</Pill>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Keeps every morning briefing online as well as on this computer, and gives each PDF a web address — which is what lets the
        Zapier email route attach it.
      </p>
      <details className="more">
        <summary>How to set it up ›</summary>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Create a project at supabase.com. Paste the project address and the secret key — the one under Settings → API Keys →
          Secret keys, never the publishable one. Then create the one table below in Supabase&apos;s SQL editor. Leaving the key box
          empty keeps the saved key, so the other boxes can change without retyping it.
        </p>
        <div className="pic-caption" style={{ marginTop: 8 }}>{s.supabase?.sql || ""}</div>
      </details>
      <div className="form-grid">
        <label className="field"><span>Project address</span><input className="input" id="sb-url" defaultValue={s.supabase?.url || ""} placeholder="https://xxxx.supabase.co" autoComplete="off" /></label>
        <label className="field"><span>Secret key</span><input className="input" id="sb-key" type="password" placeholder={s.supabase?.has_key ? "saved — leave blank to keep it" : "sb_secret_… or the service_role key"} autoComplete="off" /></label>
        <label className="field"><span>Storage folder <em>Supabase calls it a bucket</em></span><input className="input" id="sb-bucket" defaultValue={s.supabase?.bucket || "briefings"} autoComplete="off" /></label>
        <label className="field"><span>Table</span><input className="input" id="sb-table" defaultValue={s.supabase?.table || "daily_intel"} autoComplete="off" /></label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={saveSupabase}>{busy === "sb" ? "Saving…" : "Save"}</button>
        <button className="btn" type="button" disabled={Boolean(busy) || !s.supabase?.ready} onClick={testSupabase}>{busy === "sbtest" ? "Checking…" : "Check the connection"}</button>
      </div>
    </section>
  );

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Sending email</h3>
        <Pill tone={s.graph?.ready ? "ok" : "warn"}>{s.graph?.ready ? "Microsoft 365 · sends attachments" : ready ? "Zapier · text only" : "Not set up"}</Pill>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        There are two ways to send; set up either one. Circuit never holds a mail password.
      </p>

      <div className="eyebrow" style={{ marginBottom: 0 }}>Option 1 · Microsoft 365 — recommended, the PDF arrives attached</div>
      <details className="more">
        <summary>Where to find the IDs and the secret ›</summary>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          In the Microsoft Entra admin centre, register an app in your own organisation, give it the <code>Mail.Send</code> application
          permission and grant admin consent. Its overview page shows the directory and application IDs; make a client secret under
          Certificates &amp; secrets.
        </p>
      </details>
      <div className="form-grid">
        <label className="field"><span>Directory (tenant) ID</span><input className="input" id="ms-tenant" defaultValue={s.graph?.tenant || ""} placeholder="contoso.onmicrosoft.com or the GUID" autoComplete="off" /></label>
        <label className="field"><span>Application (client) ID</span><input className="input" id="ms-client" defaultValue={s.graph?.client_id || ""} autoComplete="off" /></label>
        <label className="field"><span>Client secret</span><input className="input" id="ms-secret" type="password" placeholder={s.graph?.has_secret ? "saved — leave blank to keep it" : ""} autoComplete="off" /></label>
        <label className="field"><span>Send from</span><input className="input" id="ms-from" defaultValue={s.graph?.from || ""} placeholder="marketing@yourcompany.com" autoComplete="off" /></label>
        <label className="field full"><span>Send to</span><input className="input" id="ms-to" defaultValue={s.graph?.to || ""} placeholder="you@yourcompany.com" autoComplete="off" /></label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={saveGraph}>{busy === "graph" ? "Saving…" : "Save"}</button>
        <button className="btn" type="button" disabled={Boolean(busy) || !s.graph?.ready} onClick={testGraph}>{busy === "graphtest" ? "Sending…" : "Send a test with the PDF"}</button>
      </div>

      <div className="eyebrow" style={{ marginBottom: 0, marginTop: 6 }}>Option 2 · Zapier — text only, no attachments</div>
      <details className="more">
        <summary>How to set up the Zap ›</summary>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          In Zapier: new Zap → trigger <em>Webhooks by Zapier · Catch Hook</em> → action <em>Microsoft Outlook · Send Email</em>,
          on the marketing@yourcompany.com connection. Map <code>to</code>, <code>subject</code> and <code>body</code> from the hook
          onto the email, then copy the hook address Zapier gives you into the box below.
        </p>
      </details>
      <div className="form-grid">
        <label className="field full"><span>Zapier hook address</span>
          <input className="input" id="mail-hook" defaultValue={s.hook} placeholder="https://hooks.zapier.com/hooks/catch/…" autoComplete="off" />
        </label>
        <label className="field full"><span>Send to</span>
          <input className="input" id="mail-to" defaultValue={s.to} placeholder="marketing@yourcompany.com" autoComplete="off" />
        </label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="btn" type="button" disabled={Boolean(busy) || !s.hook} onClick={test}>{busy === "test" ? "Sending…" : "Send a test"}</button>
      </div>

      {s.recent.length ? (
        <details className="more">
          <summary>Recently sent ›</summary>
          <ul className="health-list" style={{ marginTop: 8 }}>
            {s.recent.map((m) => (
              <li key={m.id} className={m.status === "sent" ? "ok" : "bad"}>
                <span className={`dot ${m.status === "sent" ? "ok" : "bad"}`} />
                <strong>{m.kind}</strong>
                <span>{m.subject}{m.error ? ` — ${m.error}` : ""}</span>
                <span className="small muted">{fmtDate(m.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
