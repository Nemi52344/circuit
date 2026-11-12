"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, postJson, fmtDate } from "@/lib/api";
import { Pill } from "@/components/ui";

/* Circuit does its work in the background, so a dead token or a signed-out ChatGPT looks like
   silence. These two say what has stopped: a one-line strip wherever you happen to be, and the
   full list in Settings. */

type Check = { key: string; label: string; state: "ok" | "warn" | "bad"; detail: string; fix?: { label: string; href: string } };
type Backup = { name: string; bytes: number; at: string };
type Health = { checked_at: string; checks: Check[]; bad: number; warn: number; backups?: Backup[]; ran?: { db_bytes: number; pictures: number } };

const mb = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const tone = (s: Check["state"]) => (s === "ok" ? "ok" : s === "warn" ? "warn" : "bad");

export function useHealth(poll = 0) {
  const [health, setHealth] = useState<Health | null>(null);
  const load = useCallback(() => api<Health>("/api/health").then(setHealth).catch(() => null), []);
  useEffect(() => {
    load();
    if (!poll) return;
    const t = setInterval(load, poll);
    return () => clearInterval(t);
  }, [load, poll]);
  return { health, reload: load, setHealth };
}

/* One line, only when something is actually wrong. */
export function HealthStrip() {
  const { health } = useHealth(120000);
  const [hidden, setHidden] = useState<string[]>([]);
  if (!health) return null;
  const broken = health.checks.filter((c) => c.state === "bad" && !hidden.includes(c.key));
  if (!broken.length) return null;
  return (
    <div className="health-strip">
      {broken.map((c) => (
        <div key={c.key} className="health-line">
          <span className="dot bad" />
          <strong>{c.label}</strong>
          <span>{c.detail}</span>
          <span className="actions">
            {c.fix ? <Link className="btn small" href={c.fix.href}>{c.fix.label}</Link> : null}
            <button className="btn small ghost" type="button" onClick={() => setHidden((h) => [...h, c.key])} aria-label="Hide">Not now</button>
          </span>
        </div>
      ))}
    </div>
  );
}

/* The whole list: every check, with the button that fixes it. */
export function HealthPanel() {
  const { health, reload } = useHealth(60000);
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Is everything working?</h3>
        <span className="actions">
          {health ? <Pill tone={health.bad ? "bad" : health.warn ? "warn" : "ok"}>{health.bad ? `${health.bad} broken` : health.warn ? `${health.warn} to look at` : "All good"}</Pill> : null}
          <button className="btn small" type="button" onClick={reload}>Check again</button>
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Circuit works in the background, so this is where it says what has stopped. It checks itself every minute while this page is open.</p>
      {health ? (
        <ul className="health-list">
          {health.checks.map((c) => (
            <li key={c.key} className={c.state}>
              <span className={`dot ${c.state}`} />
              <strong>{c.label}</strong>
              <span>{c.detail}</span>
              {c.fix && c.state !== "ok" ? <Link className="btn small" href={c.fix.href}>{c.fix.label}</Link> : <span />}
            </li>
          ))}
        </ul>
      ) : <p className="small muted" style={{ margin: 0 }}>Checking…</p>}
    </section>
  );
}

/* Daily ones are named by the date and time they ran; the rest were saved by hand before a
   change ("circuit-before-files-in-db-…"), and read better as what they were saved before. */
const DAILY = /-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;
const backupLabel = (name: string) => DAILY.test(name) ? "Daily backup"
  : `Before ${name.replace(/^[a-z0-9]+-before-/, "").replace(/\.db$/, "").replace(/-?\d{8}(-\d{6})?|-?\d{4}-\d{2}-\d{2}/g, "").replace(/-+/g, " ").trim() || "a change"}`;

/* The daily backup kept on this Mac: one database file per day, files and all. */
export function LocalBackupPanel({ push }: { push: (t: string, tone?: string) => void }) {
  const { health, setHealth } = useHealth();
  const [busy, setBusy] = useState(false);
  const backUp = async () => {
    setBusy(true);
    try {
      const r = await postJson<Health>("/api/health", { action: "backup" });
      setHealth(r);
      push(r.ran ? `Backed up ${mb(r.ran.db_bytes)}` : "Backed up", "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const list = health?.backups || [];
  const daily = list.filter((x) => DAILY.test(x.name)).length;
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Backups on this Mac</h3>
        <span className="actions">
          {health ? (daily ? <Pill tone="ok">{daily} daily kept</Pill> : <Pill tone="warn">None yet</Pill>) : null}
          <button className="btn small primary" type="button" disabled={busy} onClick={backUp}>{busy ? "Backing up…" : "Back up now"}</button>
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Once a day Circuit saves a full copy of its database — posts, pictures, videos and logins — into <code>data/backups</code>.
        The last three days are kept. This protects against a mistake; the online backup below protects against losing the Mac.
      </p>
      {list.length ? (
        <ul className="health-list">
          {list.map((b) => (
            <li key={b.name} className="ok">
              <span className="dot ok" />
              <strong>{backupLabel(b.name)}</strong>
              <span>{fmtDate(b.at)} · {mb(b.bytes)}</span>
              <span />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
