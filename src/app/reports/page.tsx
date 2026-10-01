"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { Kpi, Delta } from "@/components/Sheet";
import { money, moneyShort, monthLabel } from "@/lib/money";
import type { MonthRow, Headline } from "@/lib/reports";

/* Reports: the month beside the month before it.

   Nothing here is entered. Every figure already lives somewhere else in Circuit — the calendar,
   Instagram's numbers, the bills, the salary list — and this page only lines them up so a change
   is visible. If a number looks wrong, it is wrong at its source, and that is where to fix it. */

type Data = {
  months: MonthRow[]; headlines: Headline[];
  ahead: { n: number; first: string | null; last: string | null };
  admin: { unpaid: number; unpaid_value: number; overdue: number; items: number; stock_value: number; low: number };
  work: { total: number; doing: number; blocked: number; late: number; done_this_month: number };
};

const show = (h: Headline) =>
  h.kind === "money" ? moneyShort(h.value) : h.kind === "percent" ? `${h.value}%` : h.value.toLocaleString("en-IN");

export default function ReportsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [months, setMonths] = useState(12);
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>(`/api/reports?months=${months}`).then(setD).catch((e: Error) => push(e.message, "bad")), [push, months]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <p className="muted">Loading…</p>;
  const rows = [...d.months].reverse();
  const cur = d.months[d.months.length - 1];
  const prev = d.months[d.months.length - 2];
  const peakReach = Math.max(1, ...d.months.map((m) => m.reach));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p className="lede">
            Everything Circuit already knows, put month beside month. Nothing is typed here — the numbers come from the
            calendar, Instagram, <Link href="/admin" style={{ textDecoration: "underline" }}>Admin</Link> and{" "}
            <Link href="/finance" style={{ textDecoration: "underline" }}>Finance</Link>.
          </p>
        </div>
        <span className="actions">
          <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ minHeight: 38, width: "auto" }}>
            <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option>
          </select>
        </span>
      </div>

      <div className="grid-cards">
        {d.headlines.map((h) => (
          <div className="kpi" key={h.key}>
            <strong>{show(h)}</strong>
            <small>{h.label}</small>
            <span>
              {h.delta === null ? "no month before to compare" : (
                <>{h.delta > 0 ? "↑" : h.delta < 0 ? "↓" : "→"} {Math.abs(h.delta)}% on {prev ? monthLabel(prev.month) : "last month"}</>
              )}
            </span>
          </div>
        ))}
      </div>

      {d.ahead?.n ? (
        <p className="small muted" style={{ margin: 0 }}>
          The table below stops at this month, because a result that has not happened yet is not a result.
          Looking the other way, <Link href="/" style={{ textDecoration: "underline" }}>{d.ahead.n} posts are booked</Link> after today
          {d.ahead.last ? `, out to ${monthLabel(d.ahead.last.slice(0, 7))}` : ""}.
        </p>
      ) : null}

      <div className="split">
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><h3>Work</h3><Link className="btn small ghost" href="/work">Open the board</Link></div>
          <div className="list">
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>On the go</strong></div><span>{d.work.doing}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Blocked</strong></div><span>{d.work.blocked}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Past its date</strong></div><span className={d.work.late ? "bad-text" : ""}>{d.work.late}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Finished this month</strong></div><span>{d.work.done_this_month}</span></div>
          </div>
        </section>
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><h3>Admin</h3><Link className="btn small ghost" href="/admin">Open</Link></div>
          <div className="list">
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Bills unpaid</strong><p>{d.admin.unpaid} outstanding</p></div><span>{money(d.admin.unpaid_value)}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Overdue</strong></div><span className={d.admin.overdue ? "bad-text" : ""}>{d.admin.overdue}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Stock on hand</strong><p>{d.admin.items} items{d.admin.low ? `, ${d.admin.low} at reorder` : ""}</p></div><span>{moneyShort(d.admin.stock_value)}</span></div>
          </div>
        </section>
      </div>

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>Month on month</h3>
          <span className="small muted">Latest first</span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Month</th>
                <th className="num">Planned</th><th className="num">Posted</th><th className="num">Reach</th>
                <th className="num">Likes</th><th className="num">Comments</th><th className="num">Engagement</th>
                <th className="num">Briefings</th><th className="num">Work done</th>
                <th className="num">Revenue</th><th className="num">Cost</th><th className="num">Net</th>
              </tr></thead>
              <tbody>
                {rows.map((m, i) => {
                  const before = rows[i + 1];
                  return (
                    <tr key={m.month}>
                      <td className="strong">
                        {monthLabel(m.month)}
                        {before ? <span className="sub"><Delta now={m.pnl.net} before={before.pnl.net} /> net</span> : null}
                      </td>
                      <td className="num muted">{m.posts || "—"}</td>
                      <td className="num">{m.posted || "—"}</td>
                      <td className="num">{m.reach ? m.reach.toLocaleString("en-IN") : "—"}</td>
                      <td className="num muted">{m.likes || "—"}</td>
                      <td className="num muted">{m.comments || "—"}</td>
                      <td className="num">{m.engagement ? `${m.engagement}%` : "—"}</td>
                      <td className="num muted">{m.briefings || "—"}</td>
                      <td className="num muted">{m.tasks_done || "—"}</td>
                      <td className="num">{m.pnl.revenue ? money(m.pnl.revenue) : "—"}</td>
                      <td className="num muted">{m.pnl.costs ? money(m.pnl.costs) : "—"}</td>
                      <td className={`num strong ${m.pnl.net < 0 ? "bad-text" : ""}`}>{m.pnl.revenue || m.pnl.costs ? money(m.pnl.net) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty title="Nothing to report yet" hint="Once posts go out and the books have numbers in them, the months line up here." />}
      </section>

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>Reach, oldest to newest</h3><span className="small muted">{cur?.reach ? `${cur.reach.toLocaleString("en-IN")} this month` : "no numbers yet"}</span></div>
        <div className="mom" style={{ height: 70 }}>
          {d.months.map((m) => (
            <i key={m.month} style={{ height: `${Math.max(2, (m.reach / peakReach) * 100)}%` }} title={`${monthLabel(m.month)} · ${m.reach.toLocaleString("en-IN")} reach`} />
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Reach is read straight from Instagram against posts marked as posted. Months before you connected it stay empty, which is honest rather than broken.
        </p>
      </section>
    </div>
  );
}
