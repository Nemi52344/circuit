"use client";
import { useMemo } from "react";
import type { Task } from "@/lib/books";

/* The Work page's timeline: everything on the go as bars across the months — what overlaps,
   what is late, what nobody has started. Clicking a bar opens the task. */

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export const RANGES = [
  { key: "month", label: "This month", back: 0, len: 1 },
  { key: "quarter", label: "Three months", back: 0, len: 3 },
  { key: "half", label: "Six months", back: 1, len: 6 },
];

export function WorkTimeline({ tasks, range, onOpen }: { tasks: Task[]; range: string; onOpen: (id: string) => void }) {
  /* The window the chart covers: whole months, so the scale reads as months and not as a smear
     of dates. It always stretches to hold every task that is actually on screen. */
  const span = useMemo(() => {
    const r = RANGES.find((x) => x.key === range) || RANGES[1];
    const n = new Date();
    let from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - r.back, 1));
    let to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - r.back + r.len, 0));
    for (const t of tasks) {
      if (t.start_date && Date.parse(`${t.start_date}T00:00:00Z`) < from.getTime()) from = new Date(Date.parse(`${t.start_date}T00:00:00Z`));
      if (t.end_date && Date.parse(`${t.end_date}T00:00:00Z`) > to.getTime()) to = new Date(Date.parse(`${t.end_date}T00:00:00Z`));
    }
    return { from: iso(from), to: iso(to), span: Math.max(days(iso(from), iso(to)) + 1, 7) };
  }, [range, tasks]);

  /* Month names across the top, each as wide as the month is long. "SEP '26" rather than
     "SEPT 26", which in caps reads like the 26th of September. */
  const scale = useMemo(() => {
    const out: { label: string; pct: number }[] = [];
    const start = new Date(`${span.from}T00:00:00Z`);
    const end = new Date(`${span.to}T00:00:00Z`);
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cur <= end) {
      const mStart = new Date(Math.max(cur.getTime(), start.getTime()));
      const mEnd = new Date(Math.min(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0), end.getTime()));
      out.push({ label: `${cur.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} '${String(cur.getUTCFullYear()).slice(2)}`, pct: ((days(iso(mStart), iso(mEnd)) + 1) / span.span) * 100 });
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    return out;
  }, [span]);

  const todayPct = days(span.from, iso(new Date())) / span.span;
  const bar = (t: Task) => {
    const left = Math.max(0, days(span.from, t.start_date) / span.span) * 100;
    const width = Math.max(((days(t.start_date, t.end_date) + 1) / span.span) * 100, 1.2);
    return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
  };

  return (
    <div className="gantt" style={{ ["--gt-col" as string]: `${100 / Math.max(scale.length, 1)}%` }}>
      <div className="gantt-head">
        <div>Work</div>
        <div className="gantt-scale">{scale.map((s, i) => <span key={i} style={{ flexGrow: s.pct }}>{s.label}</span>)}</div>
      </div>
      {tasks.map((t) => (
        <div className="gantt-row" key={t.id}>
          <div className="gt-name">
            <strong onClick={() => onOpen(t.id)} style={{ cursor: "pointer" }}>{t.title}</strong>
            <small>{t.owner || "nobody yet"} · {t.status}</small>
          </div>
          <div className="gt-track">
            {todayPct >= 0 && todayPct <= 1 ? <div className="gt-today" style={{ left: `${todayPct * 100}%` }} /> : null}
            <div className={`gt-bar ${t.status === "done" ? "done" : ""} ${t.status === "blocked" ? "blocked" : ""}`}
              style={bar(t)} title={`${t.start_date} → ${t.end_date} · ${t.progress}%`} onClick={() => onOpen(t.id)}>
              <i className="fill" style={{ width: `${t.progress}%` }} />
              <span>{t.progress ? `${t.progress}%` : ""}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
