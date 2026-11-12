"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, postJson, fmtDate } from "@/lib/api";
import PeopleView from "@/components/views/PeopleView";

/* The parts of the Work page that are about work arriving and who it goes to: what came in by
   message or mail, the team's "who does what", and the mail connection. They were the Inbox
   page; they live with the work now, because that is where you look. */

type Request = { id: string; source: string; sender: string; subject: string; status: string; error: string; task_ids: string; created_at: string };
type Task = { id: string; title: string; owner: string };
type Person = { user_id: string; name: string; login: boolean; takes_work: boolean; kinds: string[]; done: Record<string, number>; open: number };
type Mail = { on: boolean; mailbox?: string; folder?: string; creds?: boolean; since?: string; last?: { at: string; ok: boolean; found: number; error?: string } | null };
export type Incoming = { requests: Request[]; tasks: Task[]; kinds: { key: string; label: string }[]; people: Person[]; mail: Mail };
type Push = (t: string, tone?: string) => void;

const ids = (r: Request): string[] => { try { return JSON.parse(r.task_ids); } catch { return []; } };

/* What the Work page needs from the old inbox, refreshed every few seconds while anything is
   still being read. */
export function useIncoming(push: Push) {
  const [d, setD] = useState<Incoming | null>(null);
  const load = useCallback(() => api<Incoming>("/api/inbox").then(setD).catch(() => null), []);
  useEffect(() => { load(); }, [load]);
  const busy = d?.requests.some((r) => r.status === "new" || r.status === "reading");
  useEffect(() => {
    const t = setInterval(load, busy ? 3000 : 30000);
    return () => clearInterval(t);
  }, [busy, load]);
  const patch = useCallback(async (body: Record<string, unknown>, done?: string) => {
    try {
      await postJson("/api/inbox", body, "PATCH");
      if (done) push(done, "ok");
    } catch (e) { push((e as Error).message, "bad"); }
    load();
  }, [load, push]);
  return { d, load, patch };
}

/* ---- what came in: messages pasted and mail received, the last three days ---- */

export function IncomingStrip({ d, manager, onRetry, onChanged }: { d: Incoming; manager: boolean; onRetry: (id: string) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const recent = d.requests.filter((r) => r.status === "new" || r.status === "reading" || Date.now() - Date.parse(r.created_at) < 3 * 86400000);
  const reading = recent.filter((r) => r.status === "new" || r.status === "reading").length;
  /* When something finishes reading, the board below has new cards — tell it. */
  const before = useRef(reading);
  useEffect(() => { if (reading < before.current) onChanged(); before.current = reading; }, [reading, onChanged]);
  if (!recent.length) return null;
  const taskById = new Map(d.tasks.map((t) => [t.id, t]));
  const shown = open ? recent : recent.slice(0, 3);
  return (
    <section className="wk-incoming" aria-label="Work that came in">
      <header>
        <strong>Came in</strong>
        <span className="muted small">{reading ? `Reading ${reading}…` : `${recent.length} in the last three days`}{d.mail.on ? " · mail connected" : ""}</span>
        {recent.length > 3 ? <button type="button" className="btn small ghost" onClick={() => setOpen(!open)}>{open ? "Show fewer" : `Show all ${recent.length}`}</button> : null}
      </header>
      {shown.map((r) => {
        const made = ids(r).map((i) => taskById.get(i)).filter((t): t is Task => Boolean(t));
        return (
          <div key={r.id} className={`wk-in-row s-${r.status}`}>
            <span className="wk-in-icon">{r.source === "mail" ? "Mail" : "Pasted"}</span>
            <div className="wk-in-main">
              <div className="wk-in-subject">{r.subject || "Message"}</div>
              <div className="wk-in-meta">{r.sender ? `${r.sender} · ` : ""}{fmtDate(r.created_at)}</div>
              {made.length ? <div className="wk-in-made">{made.map((t) => <span key={t.id}>{t.title} <b>→ {t.owner || "nobody yet"}</b></span>)}</div> : null}
              {r.error ? <div className="wk-in-err">{r.error}</div> : null}
            </div>
            <span className="wk-in-status">
              {r.status === "new" || r.status === "reading" ? <><i className="wk-spin" aria-hidden="true" /> Reading</>
                : r.status === "done" ? `${made.length} task${made.length === 1 ? "" : "s"}`
                : r.status === "nothing" ? "Nothing to do"
                : manager ? <button type="button" className="btn small" onClick={() => onRetry(r.id)}>Try again</button> : "Couldn't read"}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/* ---- who does what ---- */

/* The team, in one drawer on the Work page: who does what kind of work — which is how new work
   finds its owner — and, for the Admin, who can sign in to Circuit and with which role. */
export function TeamPanel({ d, patch, onClose, logins = false, start = "work" }: {
  d: Incoming; patch: (b: Record<string, unknown>, done?: string) => void; onClose: () => void; logins?: boolean; start?: "work" | "logins";
}) {
  const [tab, setTab] = useState<"work" | "logins">(logins ? start : "work");
  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className={`wk-drawer ${tab === "logins" ? "is-wide" : ""}`} role="dialog" aria-label="Team">
        <div className="wk-drawer-head"><h3 style={{ margin: 0, flex: 1 }}>Team</h3><button type="button" className="tb-btn" aria-label="Close" onClick={onClose}>×</button></div>
        {logins ? (
          <div className="seg wide" role="tablist" aria-label="Team">
            <button type="button" role="tab" aria-selected={tab === "work"} className={tab === "work" ? "on" : ""} onClick={() => setTab("work")}>Who does what</button>
            <button type="button" role="tab" aria-selected={tab === "logins"} className={tab === "logins" ? "on" : ""} onClick={() => setTab("logins")}>Logins and roles</button>
          </div>
        ) : null}
        {tab === "logins" && logins ? <div className="wk-logins"><PeopleView /></div> : <TeamEditor d={d} patch={patch} />}
      </aside>
    </>
  );
}

export function TeamEditor({ d, patch }: { d: Incoming; patch: (b: Record<string, unknown>, done?: string) => void }) {
  const [name, setName] = useState("");
  const kinds = d.kinds.filter((k) => k.key !== "other");
  const label = (k: string) => (k === "*" ? "Everything else" : d.kinds.find((x) => x.key === k)?.label || k);
  return (
    <>
        <p className="small muted" style={{ margin: 0 }}>New work goes to whoever does that kind. &ldquo;Everything else&rdquo; takes whatever nobody else has ticked. Circuit also learns from what each person finishes and from every card you drag to someone else.</p>
        {d.people.map((p) => (
          <div key={p.user_id} className="wk-team-row">
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <strong>{p.name}</strong>
              {!p.login ? <span className="wk-flag">no login yet</span> : null}
              <label className="wk-toggle" style={{ marginLeft: "auto" }}>
                <input type="checkbox" checked={p.takes_work} onChange={(e) => patch({ action: "profile", user_id: p.user_id, takes_work: e.target.checked })} /> Takes work
              </label>
            </div>
            <div className="small muted">{p.open} open{Object.keys(p.done).length ? ` · finished ${Object.entries(p.done).map(([k, n]) => `${n} ${label(k).toLowerCase()}`).join(", ")}` : ""}</div>
            <div className="wk-chips">
              {[{ key: "*", label: "Everything else" }, ...kinds].map((k) => {
                const on = p.kinds.includes(k.key);
                return (
                  <button key={k.key} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} disabled={!p.takes_work}
                    onClick={() => patch({ action: "profile", user_id: p.user_id, kinds: on ? p.kinds.filter((x) => x !== k.key) : [...p.kinds, k.key] })}>{k.label}</button>
                );
              })}
            </div>
          </div>
        ))}
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { patch({ action: "member", name }, `${name.trim()} added — tick what they do`); setName(""); } }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add someone who has no login yet" aria-label="Name" style={{ minHeight: 36 }} />
          <button className="btn small" type="submit">Add</button>
        </form>
        <p className="small muted" style={{ margin: 0 }}>When they get an account with the same first name, their work moves to it by itself.</p>
    </>
  );
}

/* ---- work by email ---- */

export function MailPanel({ d, patch, push, reload, onClose }: { d: Incoming; patch: (b: Record<string, unknown>, done?: string) => void; push: Push; reload: () => void; onClose: () => void }) {
  const m = d.mail;
  const [box, setBox] = useState(m.mailbox || "");
  const [folder, setFolder] = useState(m.folder || "Circuit");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try { await postJson("/api/inbox", { action: "mail-check" }, "PATCH"); push("Checked the folder", "ok"); }
    catch (e) { push((e as Error).message, "bad"); }
    finally { setBusy(false); reload(); }
  };
  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className="wk-drawer" role="dialog" aria-label="Work by email">
        <div className="wk-drawer-head"><h3 style={{ margin: 0, flex: 1 }}>Work by email</h3><button type="button" className="tb-btn" aria-label="Close" onClick={onClose}>×</button></div>
        <p className="small muted" style={{ margin: 0 }}>Circuit reads one Outlook folder. Every new email in it becomes tasks, given to the right person — like a pasted message. It only reads: nothing in your mailbox is moved or deleted, and mail from before you connect is left alone.</p>
        {!m.creds ? (
          <div className="note bad small"><strong>Microsoft 365 isn&apos;t connected yet.</strong> Set it up under Settings → Sending mail (the same app sends the daily briefing). Then come back here.</div>
        ) : null}
        <div className="wk-drawer-grid">
          <label className="field"><span>Mailbox</span><input className="input" value={box} onChange={(e) => setBox(e.target.value)} placeholder="marketing@bncmotors.in" /></label>
          <label className="field"><span>Folder</span><input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Circuit" /></label>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => patch({ action: "mail", mailbox: box, folder }, "Saved")}>Save</button>
          <button type="button" className={`btn ${m.on ? "" : "primary"}`} disabled={!m.creds} onClick={() => patch({ action: "mail", mailbox: box, folder, on: !m.on }, m.on ? "Mail reading stopped" : "Connected — Circuit looks every five minutes")}>
            {m.on ? "Stop reading mail" : "Start reading mail"}
          </button>
          {m.on ? <button type="button" className="btn ghost" disabled={busy} onClick={check}>{busy ? "Looking…" : "Look now"}</button> : null}
        </div>
        {m.last ? (
          <div className={`note small ${m.last.ok ? "ok" : "bad"}`}>
            {m.last.ok ? `Last looked ${fmtDate(m.last.at)} — ${m.last.found ? `${m.last.found} new email${m.last.found === 1 ? "" : "s"}` : "nothing new"}.` : `Last try ${fmtDate(m.last.at)} failed: ${m.last.error}`}
          </div>
        ) : null}
        <details className="wk-more" open={!m.on}>
          <summary>How to set it up (10 minutes, once)</summary>
          <ol className="small" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
            <li>In Outlook, make a folder called <b>Circuit</b> in the mailbox above.</li>
            <li>Add a rule that moves work requests there — for example, mail from the sales head, or anything sent to a work address. Or just drag an email in.</li>
            <li>Ask your Microsoft 365 admin to give the Circuit app the <b>Mail.Read</b> application permission and grant admin consent — in Azure, on the app already used for sending.</li>
            <li>Ask them to limit it to this one mailbox (an Exchange <i>application access policy</i>) — without that, Mail.Read can read every mailbox in the company.</li>
            <li>Press <b>Start reading mail</b>. Circuit looks every five minutes.</li>
          </ol>
        </details>
      </aside>
    </>
  );
}
