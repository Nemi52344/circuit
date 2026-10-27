"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, postJson } from "@/lib/api";
import { Pill, Empty, useToast, statusTone } from "@/components/ui";
import { Kpi, Tabs, Cell } from "@/components/Sheet";
import type { Task } from "@/lib/books";
import Link from "next/link";

type DoorState = { key: string; kind: "run" | "open" | "yours"; label: string; what: string; href?: string; ready: boolean; line: string };

/* What everyone is working on, as a chart rather than a list.

   A list of tasks tells you what exists. A chart tells you what overlaps, what is late, and
   what nobody has started — which is the only reason to draw one. */

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/* Who could do a piece of work. Stored as "", "person" or "app"; shown in words, because a
   dropdown containing a blank line and the word "app" tells nobody anything. */
const DOABLE: { v: string; label: string }[] = [
  { v: "", label: "not said yet" },
  { v: "person", label: "a person has to" },
  { v: "app", label: "Circuit could do this" },
];

const RANGES = [
  { key: "month", label: "This month", back: 0, len: 1 },
  { key: "quarter", label: "Three months", back: 0, len: 3 },
  { key: "half", label: "Six months", back: 1, len: 6 },
];

export default function WorkPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [area, setArea] = useState("all");
  const [range, setRange] = useState("quarter");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(0);
  const [doors, setDoors] = useState<Record<string, DoorState>>({});
  const [running, setRunning] = useState<string | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<{ tasks: Task[]; statuses: string[]; areas: string[]; programme_size: number; doors: Record<string, DoorState> }>("/api/work")
    .then((d) => { setTasks(d.tasks); setStatuses(d.statuses); setAreas(d.areas); setSize(d.programme_size || 0); setDoors(d.doors || {}); })
    .catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: Partial<Task> & { id: string }) => {
    try {
      await api("/api/work", { method: "PATCH", body: JSON.stringify(patch), headers: { "Content-Type": "application/json" } });
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };

  const add = async () => {
    setBusy(true);
    const today = iso(new Date());
    try {
      const t = await postJson<Task>("/api/work", { title: "New piece of work", start_date: today, end_date: iso(new Date(Date.now() + 6 * DAY)), area: area === "all" ? "marketing" : area });
      push("Added — give it a name", "ok");
      setOpen(t.id);
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  /* The board starts full, because Circuit already knows what is on: a month of posts with
     real dates, the things it has flagged as wrong with itself, and the work it proposed on
     its own code. Pressing this again later tops it up rather than doubling it. */
  const fill = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ added: Task[]; updated: Task[]; skipped: string[] }>("/api/work", { action: "fill" });
      const bits = [
        r.added.length ? `${r.added.length} added` : "",
        r.updated.length ? `${r.updated.length} brought up to date` : "",
      ].filter(Boolean);
      push(bits.length ? `${bits.join(", ")} from the calendar and what Circuit has flagged` : "Already up to date", bits.length ? "ok" : "");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally { setBusy(false); }
  };

  /* Everything marketing puts out, rather than only what this company has already started. The
     value is the gaps: a board built from what is happening cannot show you that nobody has
     made a spec sheet, because not making one leaves no record to read. */
  const programme = async () => {
    if (!confirm(`Put ${size || "the"} pieces of marketing work on the board — the ones Circuit can actually help with?\n\nEach comes with something to press: either Circuit does it, or it opens the screen that does. Anything already on the board with the same name is left alone.`)) return;
    setBusy(true);
    try {
      const r = await postJson<{ added: number; skipped: number }>("/api/work", { action: "programme" });
      push(r.added
        ? `${r.added} added${r.skipped ? `, ${r.skipped} already on the board` : ""} — edit or remove what you do not make`
        : "All of it is already on the board", r.added ? "ok" : "");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  /* Pressing a task's door. The work happens here rather than somewhere else that then has to
     be navigated to and found. */
  const press = async (t: Task) => {
    setRunning(t.id);
    try {
      const r = await postJson<{ made: string; detail: string; href?: string }>("/api/work", { action: "do", id: t.id });
      push(`${r.made} — ${r.detail}`, "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setRunning(null); }
  };

  const drop = async (t: Task) => {
    if (!confirm(`Remove "${t.title}"?`)) return;
    await api(`/api/work?id=${t.id}`, { method: "DELETE" });
    push("Removed", "ok");
    load();
  };

  const shown = useMemo(() => tasks.filter((t) => area === "all" || t.area === area), [tasks, area]);

  /* The window the chart covers: whole months, so the scale reads as months and not as a smear
     of dates. It always stretches to hold every task that is actually on screen. */
  const window = useMemo(() => {
    const r = RANGES.find((x) => x.key === range) || RANGES[1];
    const n = new Date();
    let from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - r.back, 1));
    let to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - r.back + r.len, 0));
    for (const t of shown) {
      if (t.start_date && Date.parse(`${t.start_date}T00:00:00Z`) < from.getTime()) from = new Date(Date.parse(`${t.start_date}T00:00:00Z`));
      if (t.end_date && Date.parse(`${t.end_date}T00:00:00Z`) > to.getTime()) to = new Date(Date.parse(`${t.end_date}T00:00:00Z`));
    }
    const span = Math.max(days(iso(from), iso(to)) + 1, 7);
    return { from: iso(from), to: iso(to), span };
  }, [range, shown]);

  /* Month names across the top, each as wide as the month is long. */
  const scale = useMemo(() => {
    const out: { label: string; pct: number }[] = [];
    const start = new Date(`${window.from}T00:00:00Z`);
    const end = new Date(`${window.to}T00:00:00Z`);
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cur <= end) {
      const mStart = new Date(Math.max(cur.getTime(), start.getTime()));
      const mEnd = new Date(Math.min(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0), end.getTime()));
      const n = days(iso(mStart), iso(mEnd)) + 1;
      /* "SEP '26" rather than "SEPT 26", which in caps reads like the 26th of September. */
      out.push({ label: `${cur.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} '${String(cur.getUTCFullYear()).slice(2)}`, pct: (n / window.span) * 100 });
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    return out;
  }, [window]);

  const today = iso(new Date());
  const todayPct = days(window.from, today) / window.span;
  const late = shown.filter((t) => t.status !== "done" && t.end_date < today);

  const bar = (t: Task) => {
    const left = Math.max(0, days(window.from, t.start_date) / window.span) * 100;
    const width = Math.max(((days(t.start_date, t.end_date) + 1) / window.span) * 100, 1.2);
    return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
  };

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Work</h2>
          <p className="lede">
            Everything on the go, as a chart — what overlaps, what is late, what nobody has started yet.
            Every piece of work here either has something Circuit can run now, or opens the screen where it is
            done with what Circuit already holds. Anything it cannot help with says so rather than sitting there
            as a row to tick.
          </p>
        </div>
        <span className="actions">
          <select className="input" aria-label="How far ahead to show" value={range} onChange={(e) => setRange(e.target.value)} style={{ minHeight: 38, width: "auto" }}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button className="btn" type="button" disabled={busy} onClick={fill} title="Reads the calendar, what Circuit has flagged, and its build queue">
            {busy ? "Working…" : "Fill from what's happening"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={programme}
            title="The marketing work Circuit can help with — each one with something to press">
            Add the standard list
          </button>
          <button className="btn primary" type="button" disabled={busy} onClick={add}>Add work</button>
        </span>
      </div>

      <div className="grid-cards">
        <Kpi label="On the go" value={String(shown.filter((t) => t.status === "doing").length)} hint="Marked as being worked on" />
        <Kpi label="Not started" value={String(shown.filter((t) => t.status === "planned").length)} />
        <Kpi label="Blocked" value={String(shown.filter((t) => t.status === "blocked").length)} tone={shown.some((t) => t.status === "blocked") ? "graphite" : ""} />
        <Kpi label="Past its date" value={String(late.length)} hint={late.length ? late[0].title : "Nothing overdue"} tone={late.length ? "graphite" : ""} />
      </div>

      <Tabs
        tabs={[{ key: "all", label: "Everything", count: tasks.length },
          ...areas.map((a) => ({ key: a, label: a[0].toUpperCase() + a.slice(1), count: tasks.filter((t) => t.area === a).length }))]}
        active={area} onPick={setArea}
      />

      {shown.length ? (
        <div className="gantt" style={{ ["--gt-col" as string]: `${100 / Math.max(scale.length, 1)}%` }}>
          <div className="gantt-head">
            <div>Work</div>
            <div className="gantt-scale">{scale.map((s, i) => <span key={i} style={{ flexGrow: s.pct }}>{s.label}</span>)}</div>
          </div>
          {shown.map((t) => (
            <div className="gantt-row" key={t.id}>
              <div className="gt-name">
                <strong onClick={() => setOpen(open === t.id ? null : t.id)} style={{ cursor: "pointer" }}>{t.title}</strong>
                {/* What to do about it, rather than only what it is called. A piece of work with
                    no door says so, which is more use than an empty status dropdown. */}
                {(() => {
                  const d = t.door ? doors[t.door] : undefined;
                  if (!d) return <small>{t.owner || "unassigned"} · {t.status}</small>;
                  return (
                    <span className="gt-door">
                      {d.kind === "run" ? (
                        <button className="btn small primary" type="button"
                          disabled={!d.ready || running === t.id || t.status === "done"}
                          title={d.ready ? d.what : d.line}
                          onClick={() => press(t)}>
                          {running === t.id ? "Working…" : d.label}
                        </button>
                      ) : d.href ? (
                        <Link className="btn small" href={d.href} title={d.what}>{d.label}</Link>
                      ) : null}
                      <i className={d.ready ? "" : "not-ready"}>{d.line}</i>
                    </span>
                  );
                })()}
              </div>
              <div className="gt-track">
                {todayPct >= 0 && todayPct <= 1 ? <div className="gt-today" style={{ left: `${todayPct * 100}%` }} /> : null}
                <div
                  className={`gt-bar ${t.status === "done" ? "done" : ""} ${t.status === "blocked" ? "blocked" : ""}`}
                  style={bar(t)} title={`${t.start_date} → ${t.end_date} · ${t.progress}%`}
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                >
                  <i className="fill" style={{ width: `${t.progress}%` }} />
                  <span>{t.progress ? `${t.progress}%` : ""}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty title="Nothing on the board" hint="Press “Fill from what's happening” and Circuit puts the month's content, anything it has flagged, and its own build queue on here with real dates." />}

      {open ? (() => {
        const t = shown.find((x) => x.id === open);
        if (!t) return null;
        return (
          <section className="panel stack">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <h3>{t.title || "Untitled"}</h3>
              <span className="actions">
                <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                <button className="btn small ghost" type="button" onClick={() => drop(t)}>Remove</button>
                <button className="btn small" type="button" onClick={() => setOpen(null)}>Close</button>
              </span>
            </div>
            <div className="form-grid">
              <label className="field"><span>What it is</span><Cell value={t.title} onSave={(v) => save({ id: t.id, title: v })} /></label>
              <label className="field"><span>Who has it</span><Cell value={t.owner} onSave={(v) => save({ id: t.id, owner: v })} placeholder="a name" /></label>
              <label className="field"><span>Starts</span><Cell value={t.start_date} onSave={(v) => save({ id: t.id, start_date: v })} type="date" /></label>
              <label className="field"><span>Ends</span><Cell value={t.end_date} onSave={(v) => save({ id: t.id, end_date: v })} type="date" /></label>
              <label className="field"><span>Where it sits</span><Cell value={t.area} onSave={(v) => save({ id: t.id, area: v })} options={areas} /></label>
              <label className="field"><span>How it is going</span><Cell value={t.status} onSave={(v) => save({ id: t.id, status: v })} options={statuses} /></label>
              <label className="field"><span>How far along (%)</span><Cell value={t.progress} onSave={(v) => save({ id: t.id, progress: Math.max(0, Math.min(100, Number(v) || 0)) })} type="number" align="num" /></label>
              <label className="field"><span>Should take (minutes)</span><Cell value={t.estimate_minutes ?? ""} onSave={(v) => save({ id: t.id, estimate_minutes: Math.max(0, Number(v) || 0) })} type="number" align="num" placeholder="0" /></label>
              <label className="field"><span>Actually took (minutes)</span><Cell value={t.spent_minutes ?? ""} onSave={(v) => save({ id: t.id, spent_minutes: Math.max(0, Number(v) || 0) })} type="number" align="num" placeholder="0" /></label>
              <label className="field"><span>Who could do it</span>
                <select className="input" style={{ minHeight: 30, padding: "0 6px", fontSize: 13 }}
                  value={t.doable_by || ""} onChange={(e) => save({ id: t.id, doable_by: e.target.value })}>
                  {DOABLE.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                </select>
              </label>
            </div>
            {(() => {
              const d = t.door ? doors[t.door] : undefined;
              if (!d) {
                return (
                  <div className="note small">
                    <strong>Circuit has nothing it can run for this one.</strong>
                    It is yours — the board is keeping track of it, nothing more.
                  </div>
                );
              }
              return (
                <div className="note stack" style={{ gap: 8 }}>
                  <div>
                    <strong className="small">{d.kind === "run" ? "Circuit can do this" : "Where this is done"}</strong>
                    <div className="small muted">{d.what}</div>
                  </div>
                  <div className="small">{d.ready ? d.line : <span className="bad-text">{d.line}</span>}</div>
                  <div className="actions">
                    {d.kind === "run"
                      ? <button className="btn small primary" type="button" disabled={!d.ready || running === t.id} onClick={() => press(t)}>
                          {running === t.id ? "Working…" : d.label}
                        </button>
                      : d.href ? <Link className="btn small primary" href={d.href}>{d.label}</Link> : null}
                  </div>
                </div>
              );
            })()}
            <label className="field"><span>Notes</span>
              <Cell value={t.notes} onSave={(v) => save({ id: t.id, notes: v })} placeholder="anything worth remembering" />
            </label>
          </section>
        );
      })() : null}
    </div>
  );
}
