"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtDay } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";

type Connection = { key: string; name: string; what: string; state: string; detail: string; blocker?: string; where?: string };
type Bot = { id: string; name: string; purpose: string; searches: boolean; active: boolean; builtin: boolean; runs: number; fails: number; last_run: string; last_error: string; last_seconds: number; state: string };
type Routine = { id: string; name: string; trigger: string; at_time: string; active: boolean; runs: number; failed: number; waiting: number; last: string };
type TimeArea = { area: string; machine_minutes: number; person_minutes: number; automated: number | null; runs: number; tasks: number; could_automate_minutes: number };
type TimePicture = {
  machine_minutes: number; person_minutes: number; automated: number | null; measured_from: string;
  areas: TimeArea[];
  heaviest: { what: string; kind: string; minutes: number; detail: string }[];
  gaps: string[];
};
type PersonTime = { owner: string; tasks: number; minutes: number; automatable_minutes: number; could_come_off: number | null; unmarked_minutes: number; estimated: number; actual: number; heaviest: string };
type PeoplePicture = { people: PersonTime[]; total_minutes: number; automatable_minutes: number; unmarked_minutes: number; gaps: string[] };
type Skill = { name: string; what: string; group: string; where: string; source: string };
type Server = { name: string; what: string; command: string; enabled: boolean; source: string };
type Toolbox = { skills: Skill[]; servers: Server[]; roots: { path: string; exists: boolean; found: number }[]; model: string; notes: string[] };
type Payload = { time: TimePicture; people: PeoplePicture; toolbox: Toolbox; connections: Connection[]; bots: Bot[]; routines: Routine[]; summary: Record<string, number> };

/* Minutes read badly past an hour and hours read badly below one. */
const dur = (m: number): string => {
  if (!m) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

const CONN_TONE: Record<string, string> = { live: "ok", set: "info", missing: "warn", blocked: "" };
const BOT_TONE: Record<string, string> = { working: "ok", failing: "bad", "not recorded": "", off: "" };

export default function AutomationPage() {
  const [d, setD] = useState<Payload | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => {
    api<Payload>("/api/automation").then(setD).catch((e: Error) => push(e.message, "bad"));
  }, [push]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="stack">{view}<Empty title="Reading what is connected" hint="One moment." /></div>;

  const s = d.summary;
  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Crons</h2>
          <p className="lede">
            Everything that runs without being asked, everything Circuit is plugged into, and every skill on this
            Mac — the bots, the connections, the routines and what Claude and ChatGPT can do.
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><b>{d.toolbox?.skills.length ?? 0}</b><span>skills on this Mac</span></div>
        <div className="stat"><b>{s.live}</b><span>connected and live</span></div>
        <div className="stat"><b>{s.missing}</b><span>not connected</span></div>
        <div className="stat"><b>{s.bots_working}</b><span>bots working</span></div>
        <div className="stat"><b>{s.routines_scheduled}</b><span>routines on a schedule</span></div>
      </div>

      {/* ---- where the time goes ---- */}
      <section className="panel stack">
        <div className="panel-head">
          <h3>Where the time goes</h3>
          <span className="muted small">Work that has actually been done, since {d.time.measured_from} — an estimate on something nobody has started is not counted.</span>
        </div>

        {d.time.automated === null ? (
          <Empty
            title="Nothing measured yet"
            hint="Durations come from routine runs and from the minutes put against work on the board. Run a routine, or put an estimate on a task, and the split appears here."
          />
        ) : (
          <>
            <div className="stat-row">
              <div className="stat"><b>{d.time.automated}%</b><span>of measured time ran without a person</span></div>
              <div className="stat"><b>{dur(d.time.machine_minutes)}</b><span>Circuit did by itself</span></div>
              <div className="stat"><b>{dur(d.time.person_minutes)}</b><span>still needed somebody</span></div>
            </div>

            {/* The figure is only as good as what fed it, so what fed it is stated next to it
                rather than in a tooltip nobody opens. */}
            {d.time.gaps.length ? (
              <div className="note stack" style={{ gap: 6 }}>
                <strong className="small">What this number does not know</strong>
                {d.time.gaps.map((g, i) => <div key={i} className="small muted">{g}</div>)}
              </div>
            ) : null}

            {d.time.areas.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Area</th><th>Circuit</th><th>A person</th><th>Automated</th><th className="wrap">Could be handed over</th></tr></thead>
                  <tbody>
                    {d.time.areas.map((a) => (
                      <tr key={a.area}>
                        <td><strong>{a.area}</strong>
                          <div className="small muted">
                            {a.runs ? `${a.runs} run${a.runs === 1 ? "" : "s"}` : ""}
                            {a.runs && a.tasks ? " · " : ""}
                            {a.tasks ? `${a.tasks} task${a.tasks === 1 ? "" : "s"} timed` : ""}
                          </div>
                        </td>
                        <td>{dur(a.machine_minutes)}</td>
                        <td>{dur(a.person_minutes)}</td>
                        <td>{a.automated === null ? "—" : <Pill tone={a.automated >= 80 ? "ok" : a.automated >= 40 ? "info" : "warn"}>{a.automated}%</Pill>}</td>
                        <td className="wrap">
                          {a.could_automate_minutes
                            ? <>{dur(a.could_automate_minutes)} <span className="small muted">marked as something Circuit could do</span></>
                            : <span className="muted">nothing marked</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {d.time.heaviest.length ? (
              <>
                <div className="panel-head" style={{ marginBottom: 0 }}>
                  <h3 style={{ fontSize: 15 }}>The slowest things</h3>
                  <span className="muted small">Longest first. This is the list to shorten.</span>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th className="wrap">What</th><th>Took</th><th className="wrap">Who did it</th></tr></thead>
                    <tbody>
                      {d.time.heaviest.map((h, i) => (
                        <tr key={i}>
                          <td className="wrap"><strong>{h.what}</strong></td>
                          <td>{dur(h.minutes)}</td>
                          <td className="wrap">
                            <Pill tone={h.kind === "machine" ? "ok" : "warn"}>{h.kind === "machine" ? "Circuit" : "a person"}</Pill>
                            <div className="small muted" style={{ marginTop: 3 }}>{h.detail}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        )}
      </section>

      {/* ---- whose week is going where ---- */}
      {d.people?.people?.length ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>Whose week is going where</h3>
            <span className="muted small">From the work board. A routine that waited knows how long, not who for, so none of that is here.</span>
          </div>
          <div className="stat-row">
            <div className="stat"><b>{dur(d.people.total_minutes)}</b><span>on the board, timed</span></div>
            <div className="stat"><b>{dur(d.people.automatable_minutes)}</b><span>marked as work Circuit could take over</span></div>
            <div className="stat"><b>{d.people.people.length}</b><span>people with timed work</span></div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Who</th><th>Timed</th><th>Could come off them</th><th className="wrap">Their heaviest</th><th>Guess vs reality</th></tr></thead>
              <tbody>
                {d.people.people.map((p) => (
                  <tr key={p.owner}>
                    <td><strong>{p.owner}</strong><div className="small muted">{p.tasks} task{p.tasks === 1 ? "" : "s"}</div></td>
                    <td>{dur(p.minutes)}</td>
                    <td>
                      {p.could_come_off === null
                        ? <span className="muted">none of it judged yet</span>
                        : <><Pill tone={p.could_come_off >= 50 ? "warn" : "ok"}>{p.could_come_off}%</Pill>
                            <div className="small muted">{dur(p.automatable_minutes)} of {dur(p.minutes - p.unmarked_minutes)} judged</div></>}
                    </td>
                    <td className="wrap">{p.heaviest || <span className="muted">—</span>}</td>
                    <td>
                      {p.estimated && p.actual
                        ? <>{dur(p.estimated)} → {dur(p.actual)}
                            <div className="small muted">{p.actual > p.estimated ? `${Math.round(((p.actual - p.estimated) / p.estimated) * 100)}% over` : p.actual < p.estimated ? `${Math.round(((p.estimated - p.actual) / p.estimated) * 100)}% under` : "on the nose"}</div></>
                        : <span className="muted">not both recorded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.people.gaps.length ? (
            <div className="note stack" style={{ gap: 6 }}>
              <strong className="small">What this does not know</strong>
              {d.people.gaps.map((g, i) => <div key={i} className="small muted">{g}</div>)}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- connections ---- */}
      <section className="panel stack">
        <div className="panel-head">
          <h3>Connections</h3>
          <span className="muted small">Every service Circuit can reach, and what it is used for.</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Service</th><th className="wrap">What it does</th><th>State</th><th className="wrap">Detail</th><th /></tr></thead>
            <tbody>
              {d.connections.map((c) => (
                <tr key={c.key}>
                  <td><strong>{c.name}</strong></td>
                  <td className="wrap">{c.what}</td>
                  <td><Pill tone={CONN_TONE[c.state] || ""}>{c.state}</Pill></td>
                  <td className="wrap">
                    {c.detail}
                    {/* A blocked service is not a missing key, and saying so stops somebody
                        hunting Settings for a field that does not exist. */}
                    {c.blocker ? <div className="small muted" style={{ marginTop: 3 }}>{c.blocker}</div> : null}
                  </td>
                  <td>{c.where ? <Link className="btn small ghost" href={c.where}>Settings</Link> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- bots ---- */}
      <section className="panel stack">
        <div className="panel-head">
          <h3>Bots</h3>
          <span className="muted small">The agents that read, research and write. Run tracking started on 21 Oct 2026 — anything marked &ldquo;not recorded&rdquo; has not run since then, which is not the same as never having run.</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Bot</th><th className="wrap">What it is for</th><th>State</th><th>Runs</th><th className="wrap">Last</th></tr></thead>
            <tbody>
              {d.bots.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong>{b.searches ? <div className="small muted">searches the web</div> : null}</td>
                  <td className="wrap">{b.purpose}</td>
                  <td><Pill tone={BOT_TONE[b.state] || ""}>{b.state}</Pill></td>
                  <td>{b.runs ? `${b.runs}${b.fails ? ` · ${b.fails} failed` : ""}` : "—"}</td>
                  <td className="wrap">
                    {b.last_run ? `${fmtDay(b.last_run)}${b.last_seconds ? ` · ${b.last_seconds}s` : ""}` : "—"}
                    {b.last_error ? <div className="small bad-text" style={{ marginTop: 3 }}>{b.last_error.slice(0, 120)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- what Claude and ChatGPT can do ---- */}
      {d.toolbox ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>Skills</h3>
            <span className="muted small">
              Read from the folders on this Mac every time this page loads{d.toolbox.model ? ` · ChatGPT is on ${d.toolbox.model}` : ""}
            </span>
          </div>

          {/* Where it looked, and what it found there. A list quietly missing a folder looks
              exactly like a folder with nothing in it. */}
          <div className="roots">
            {d.toolbox.roots.map((r) => (
              <span key={r.path} className={`root ${r.exists ? "" : "gone"}`}>
                <code>{r.path}</code>
                <i>{r.exists ? `${r.found} skill${r.found === 1 ? "" : "s"}` : "not on this Mac"}</i>
              </span>
            ))}
          </div>

          {d.toolbox.skills.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Skill</th><th>Where it came from</th><th className="wrap">What it does</th></tr></thead>
                <tbody>
                  {d.toolbox.skills.map((k) => (
                    <tr key={`${k.group}/${k.name}`}>
                      <td><strong>{k.name}</strong></td>
                      <td>{k.group ? <Pill>{k.group}</Pill> : <span className="muted small">on its own</span>}</td>
                      <td className="wrap">{k.what || <span className="muted">no description in its SKILL.md</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {d.toolbox.servers.length ? (
            <>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <h3 style={{ fontSize: 15 }}>What ChatGPT is wired into</h3>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Server</th><th>State</th><th className="wrap">What runs it</th></tr></thead>
                  <tbody>
                    {d.toolbox.servers.map((v) => (
                      <tr key={v.name} className={v.enabled ? "" : "set-aside"}>
                        <td><strong>{v.name}</strong></td>
                        <td><Pill tone={v.enabled ? "ok" : ""}>{v.enabled ? "on" : "switched off"}</Pill></td>
                        <td className="wrap"><code className="tagged">{v.command || "—"}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {d.toolbox.notes.length ? (
            <div className="note stack" style={{ gap: 6 }}>
              {d.toolbox.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- routines ---- */}
      <section className="panel stack">
        <div className="panel-head">
          <h3>Routines</h3>
          <span className="muted small">Workflows that run on a schedule rather than when you press something.</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Routine</th><th>When</th><th>Runs</th><th>Failed</th><th>Waiting</th><th>Last ran</th></tr></thead>
            <tbody>
              {d.routines.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.trigger === "manual" ? <span className="muted">when you press it</span> : `${r.trigger} · ${r.at_time}`}</td>
                  <td>{r.runs || "—"}</td>
                  <td>{r.failed ? <Pill tone="bad">{r.failed}</Pill> : "—"}</td>
                  <td>{r.waiting ? <Pill tone="warn">{r.waiting}</Pill> : "—"}</td>
                  <td>{r.last ? fmtDay(r.last) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
