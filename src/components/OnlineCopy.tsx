"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDate } from "@/lib/api";
import { Pill } from "@/components/ui";
import { useMe } from "@/components/Gate";
import { can } from "@/lib/roles";

/* The online copy in Turso. Circuit keeps working on this Mac; every minute the rows that
   changed — files included — are sent to Turso, so the data survives the Mac. "Check" rebuilds the whole
   database from Turso alone and compares it with this one, row for row. */

type Run = { at: string; ok: boolean; sent: number; deleted: number; tables: number; seconds: number; error?: string; rebuilt?: string[] };
type Check = { at: string; ok: boolean; tables: number; rows: number; differences: string[] };
type Mirror = { url: string; has_token: boolean; ready: boolean; finance: boolean; last: Run | null; check: Check | null };

export function OnlineCopyPanel({ push }: { push: (t: string, tone?: string) => void }) {
  const { me } = useMe();
  const [m, setM] = useState<Mirror | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api<Mirror>("/api/mirror").then((x) => { setM(x); setUrl(x.url); }).catch(() => null), []);
  useEffect(() => { load(); }, [load]);
  if (!m) return null;

  const act = async (action: string, body: Record<string, unknown> = {}, done = "") => {
    setBusy(action);
    try {
      const x = await postJson<Mirror>("/api/mirror", { action, ...body });
      setM(x);
      if (action === "save") setToken("");
      if (done) push(done, "ok");
    } catch (e) {
      push((e as Error).message, "bad");
      load();
    } finally {
      setBusy("");
    }
  };

  const last = m.last;
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Online backup</h3>
        {!m.ready ? <Pill>Not set up</Pill> : last && !last.ok ? <Pill tone="bad">Last backup failed</Pill> : last ? <Pill tone="ok">Up to date</Pill> : <Pill tone="warn">Nothing sent yet</Pill>}
      </div>
      <p className="small muted" style={{ marginTop: -8 }}>
        Every minute Circuit sends whatever changed — posts, pictures, videos, logins — to a free online database at Turso,
        so a complete copy survives if this Mac is lost or breaks. API keys and sign-in sessions never leave the Mac, and
        passwords only go scrambled{m.finance ? "" : ". Salaries and finance stay on the Mac until you tick the box below"}.
      </p>

      <div className="form-grid">
        <label className="field"><span>Backup address <em>from Turso, ends in .turso.io</em></span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="libsql://circuit-bnc-yourorg.turso.io" autoComplete="off" /></label>
        <label className="field"><span>Access token <em>{m.has_token ? "saved — leave blank to keep it" : "from Turso"}</em></span>
          <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={m.has_token ? "••••••••" : "Paste the token"} autoComplete="off" /></label>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={!!busy} onClick={() => act("save", { url, token }, "Saved")}>Save</button>
        {m.ready ? <button className="btn" type="button" disabled={!!busy} onClick={() => act("push", {}, "Backed up online")}>{busy === "push" ? "Backing up…" : "Back up now"}</button> : null}
        {m.ready ? <button className="btn" type="button" disabled={!!busy} onClick={() => act("check")}>{busy === "check" ? "Testing the restore…" : "Test a full restore"}</button> : null}
      </div>

      {last ? (
        <div className={`note ${last.ok ? "ok" : "bad"}`}>
          {last.ok
            ? <>Last backed up {fmtDate(last.at)}: {last.sent + last.deleted ? `${last.sent} change${last.sent === 1 ? "" : "s"} sent, ${last.deleted} removed` : "nothing had changed since the minute before"}.{last.rebuilt?.length ? ` Sent again in full because the online copy no longer matched: ${last.rebuilt.join(", ")}.` : ""}</>
            : <>The backup at {fmtDate(last.at)} failed: {last.error}</>}
        </div>
      ) : null}
      {m.check ? (
        <div className={`note ${m.check.ok ? "ok" : "bad"}`}>
          {m.check.ok
            ? <>Restore tested {fmtDate(m.check.at)}: rebuilt from the online backup alone, and all {m.check.rows.toLocaleString("en-IN")} records match this Mac.</>
            : <>Restore tested {fmtDate(m.check.at)}: the online backup differs — {m.check.differences.join("; ")}</>}
        </div>
      ) : null}

      {can(me, "finance") ? (
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={m.finance} disabled={!!busy} onChange={(e) => act("finance", { finance: e.target.checked }, e.target.checked ? "Finance goes online with the next backup" : "Finance taken out of the online backup")} />
          <span className="small">Include salaries, bills and P&amp;L in the online backup <em className="muted">(Admin only)</em></span>
        </label>
      ) : null}
    </section>
  );
}
