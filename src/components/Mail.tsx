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

export function MailPanel({ push }: { push: (t: string, tone?: string) => void }) {
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

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Sending mail</h3>
        <Pill tone={s.graph?.ready ? "ok" : ready ? "warn" : "warn"}>{s.graph?.ready ? "Microsoft 365 · attachments work" : ready ? "Zapier only · no attachments" : "Not set up"}</Pill>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Circuit has no mail server and holds no mail password. It posts the message to one Zapier hook,
        and Zapier sends it from marketing@bncmotors.in through Outlook — the connection you already have —
        so you can see, pause or change it in Zapier at any time.
      </p>

      <div className="eyebrow" style={{ marginBottom: 0 }}>Microsoft 365 — the one that carries attachments</div>
      <p className="small muted" style={{ margin: 0 }}>
        The Zapier route can send words but not files: its email step only takes a file already on the internet,
        and the briefing PDFs live on this Mac. Microsoft takes the file itself, so the PDF arrives properly attached.
        Register an app in your own tenant with the <code>Mail.Send</code> application permission, grant admin consent, and paste the three values.
      </p>
      <div className="form-grid">
        <label className="field"><span>Directory (tenant) ID</span><input className="input" id="ms-tenant" defaultValue={s.graph?.tenant || ""} placeholder="contoso.onmicrosoft.com or the GUID" autoComplete="off" /></label>
        <label className="field"><span>Application (client) ID</span><input className="input" id="ms-client" defaultValue={s.graph?.client_id || ""} autoComplete="off" /></label>
        <label className="field"><span>Client secret</span><input className="input" id="ms-secret" type="password" placeholder={s.graph?.has_secret ? "saved" : ""} autoComplete="off" /></label>
        <label className="field"><span>Send from</span><input className="input" id="ms-from" defaultValue={s.graph?.from || ""} placeholder="marketing@bncmotors.in" autoComplete="off" /></label>
        <label className="field full"><span>Send to</span><input className="input" id="ms-to" defaultValue={s.graph?.to || ""} placeholder="prasanth.r@bncmotors.in" autoComplete="off" /></label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={saveGraph}>{busy === "graph" ? "Saving…" : "Save Microsoft 365"}</button>
        <button className="btn" type="button" disabled={Boolean(busy) || !s.graph?.ready} onClick={testGraph}>{busy === "graphtest" ? "Sending…" : "Send a test with the PDF"}</button>
      </div>

      <div className="note small" style={{ marginTop: 6 }}>
        <strong>Or the Zapier hook, for words only</strong>
        In Zapier: new Zap → trigger <em>Webhooks by Zapier · Catch Hook</em> → action <em>Microsoft Outlook · Send Email</em>,
        on the marketing@bncmotors.in connection. Map <code>to</code>, <code>subject</code> and <code>body</code> from the hook
        onto the email. Copy the hook URL Zapier gives you into the box below.
      </div>

      <div className="form-grid">
        <label className="field full"><span>The hook URL from Zapier</span>
          <input className="input" id="mail-hook" defaultValue={s.hook} placeholder="https://hooks.zapier.com/hooks/catch/…" autoComplete="off" />
        </label>
        <label className="field full"><span>Send to</span>
          <input className="input" id="mail-to" defaultValue={s.to} placeholder="marketing@bncmotors.in" autoComplete="off" />
        </label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="btn" type="button" disabled={Boolean(busy) || !s.hook} onClick={test}>{busy === "test" ? "Sending…" : "Send a test"}</button>
      </div>

      <div className="eyebrow" style={{ marginBottom: 0 }}>Supabase — the archive off this Mac</div>
      <p className="small muted" style={{ margin: 0 }}>
        A second home for the briefings: the archive stops living on one laptop, and a PDF in Supabase Storage
        gets a real address on the internet — which is what lets the Zapier route attach a file at all.
        Create a project at supabase.com, then paste the project URL and the service (secret) key —
        the one under Settings → API Keys → Secret keys, never the publishable one. Leaving the key box
        empty keeps whatever is already saved, so the other boxes can be changed without retyping it.
      </p>
      <div className="form-grid">
        <label className="field"><span>Project URL</span><input className="input" id="sb-url" defaultValue={s.supabase?.url || ""} placeholder="https://xxxx.supabase.co" autoComplete="off" /></label>
        <label className="field"><span>Service role key</span><input className="input" id="sb-key" type="password" placeholder={s.supabase?.has_key ? "saved — leave blank to keep it" : "sb_secret_… or the service_role key"} autoComplete="off" /></label>
        <label className="field"><span>Storage bucket</span><input className="input" id="sb-bucket" defaultValue={s.supabase?.bucket || "briefings"} autoComplete="off" /></label>
        <label className="field"><span>Table</span><input className="input" id="sb-table" defaultValue={s.supabase?.table || "daily_intel"} autoComplete="off" /></label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={saveSupabase}>{busy === "sb" ? "Saving…" : "Save Supabase"}</button>
        <button className="btn" type="button" disabled={Boolean(busy) || !s.supabase?.ready} onClick={testSupabase}>{busy === "sbtest" ? "Checking…" : "Check the bucket"}</button>
      </div>
      <details className="more">
        <summary>The one table to create in Supabase ›</summary>
        <div className="pic-caption" style={{ marginTop: 8 }}>{s.supabase?.sql || ""}</div>
      </details>

      {s.recent.length ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 0 }}>What has gone out</div>
          <ul className="health-list">
            {s.recent.map((m) => (
              <li key={m.id} className={m.status === "sent" ? "ok" : "bad"}>
                <span className={`dot ${m.status === "sent" ? "ok" : "bad"}`} />
                <strong>{m.kind}</strong>
                <span>{m.subject}{m.error ? ` — ${m.error}` : ""}</span>
                <span className="small muted">{fmtDate(m.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
