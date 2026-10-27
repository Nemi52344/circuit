"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { Kpi, Delta } from "@/components/Sheet";
import { money, moneyShort, monthLabel } from "@/lib/money";
import type { MonthRow, Headline, SocialReport, WorkReport } from "@/lib/reports";
import { LineChart, type Point } from "@/components/Chart";

/* Reports: the month beside the month before it.

   Nothing here is entered. Every figure already lives somewhere else in Circuit — the calendar,
   Instagram's numbers, the bills, the salary list — and this page only lines them up so a change
   is visible. If a number looks wrong, it is wrong at its source, and that is where to fix it. */

type Data = {
  months: MonthRow[]; headlines: Headline[];
  ahead: { n: number; first: string | null; last: string | null };
  /* Absent for anyone who does not run the spend — the server leaves it out. */
  admin: { unpaid: number; unpaid_value: number; overdue: number; items: number; stock_value: number; low: number } | null;
  /* Whether this account may see revenue, cost and net. When false the server has already
     zeroed them, and the columns are left off rather than shown as dashes. */
  can_see_money?: boolean;
  work: { total: number; doing: number; blocked: number; late: number; done_this_month: number };
  social: SocialReport;
  worked: WorkReport;
};

const hrs = (m: number) => (m >= 60 ? `${Math.round(m / 60)}h` : m ? `${m}m` : "—");
const num = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "—" : v.toLocaleString("en-IN"));

const show = (h: Headline) =>
  h.kind === "money" ? moneyShort(h.value) : h.kind === "percent" ? `${h.value}%` : h.value.toLocaleString("en-IN");

export default function ReportsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [months, setMonths] = useState(12);
  /* Which line the social chart draws. Posts, reach and engagement answer different questions
     and do not belong on one axis. */
  const [socialLine, setSocialLine] = useState<"posts" | "reach" | "engagement">("posts");
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
          <select className="input" aria-label="How many months to report on" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ minHeight: 38, width: "auto" }}>
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
        {d.admin ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><h3>Admin</h3><Link className="btn small ghost" href="/admin">Open</Link></div>
          <div className="list">
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Bills unpaid</strong><p>{d.admin.unpaid} outstanding</p></div><span>{money(d.admin.unpaid_value)}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Overdue</strong></div><span className={d.admin.overdue ? "bad-text" : ""}>{d.admin.overdue}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Stock on hand</strong><p>{d.admin.items} items{d.admin.low ? `, ${d.admin.low} at reorder` : ""}</p></div><span>{moneyShort(d.admin.stock_value)}</span></div>
          </div>
        </section>
        ) : null}
      </div>

      {/* ---- the social media report ---- */}
      {d.social?.months?.length ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>Social media, month by month</h3>
            <span className="muted small">
              Read from the account's own history — {d.social.totals.posts} posts across {d.social.totals.months} months
              with something in them, {d.social.from} to {d.social.to}
            </span>
          </div>

          <div className="stat-row">
            <div className="stat"><b>{d.social.totals.posts}</b><span>posts published</span></div>
            <div className="stat"><b>{num(d.social.totals.reach)}</b><span>people reached</span></div>
            <div className="stat"><b>{num(d.social.totals.interactions)}</b><span>likes, comments and saves</span></div>
            <div className="stat">
              <b>{d.social.busiest ? d.social.busiest.posts : "—"}</b>
              <span>most in one month{d.social.busiest ? ` · ${d.social.busiest.label}` : ""}</span>
            </div>
          </div>

          <div className="ig-chart">
            <div className="ig-chart-head">
              <span className="eyebrow">
                {socialLine === "posts" ? "Posts published each month" : socialLine === "reach" ? "People reached each month" : "Engagement rate each month"}
              </span>
              <div className="seg">
                {(["posts", "reach", "engagement"] as const).map((k) => (
                  <button key={k} type="button" className={`seg-btn ${socialLine === k ? "on" : ""}`}
                    aria-pressed={socialLine === k} onClick={() => setSocialLine(k)}>
                    {k === "posts" ? "Posts" : k === "reach" ? "Reach" : "Engagement"}
                  </button>
                ))}
              </div>
            </div>
            <LineChart
              unit={socialLine === "posts" ? "posts" : socialLine === "reach" ? "reached" : "% of reach"}
              points={d.social.months.map((m): Point => ({
                label: m.label,
                value: socialLine === "posts" ? m.posts : socialLine === "reach" ? m.reach : (m.engagement || 0),
                note: m.posts ? `${m.reels} reel${m.reels === 1 ? "" : "s"}, ${m.carousels} carousel${m.carousels === 1 ? "" : "s"}, ${m.stills} still${m.stills === 1 ? "" : "s"}` : "",
                thin: m.thin,
                /* A month with nothing posted breaks the line everywhere except the posts
                   view, where zero posts is the fact being reported. */
                empty: socialLine !== "posts" && m.posts === 0,
              }))}
            />
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Month</th><th className="num">Posts</th><th className="num">Reels</th><th className="num">Carousels</th>
                <th className="num">Stills</th><th className="num">Reach</th><th className="num">Avg reach</th>
                <th className="num">Interactions</th><th className="num">Engagement</th><th className="num">Best post</th>
              </tr></thead>
              <tbody>
                {[...d.social.months].reverse().map((m) => (
                  <tr key={m.month} className={m.posts ? "" : "set-aside"}>
                    <td className="strong">{m.label}{m.thin ? <span className="sub">thin month</span> : null}</td>
                    <td className="num">{m.posts || "—"}</td>
                    <td className="num muted">{m.reels || "—"}</td>
                    <td className="num muted">{m.carousels || "—"}</td>
                    <td className="num muted">{m.stills || "—"}</td>
                    <td className="num">{num(m.reach)}</td>
                    <td className="num muted">{num(m.avg_reach)}</td>
                    <td className="num">{num(m.interactions)}</td>
                    <td className="num">{m.engagement === null ? "—" : `${m.engagement}%`}</td>
                    <td className="num muted">{num(m.best_reach)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d.social.by_format.length ? (
            <>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <h3 style={{ fontSize: 15 }}>Which format earns its place</h3>
                <span className="small muted">Formats with at least three posts behind them</span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Format</th><th className="num">Posts</th><th className="num">Average reach</th><th className="num">Average interactions</th></tr></thead>
                  <tbody>
                    {d.social.by_format.map((f) => (
                      <tr key={f.label}>
                        <td className="strong">{f.label}</td>
                        <td className="num">{f.posts}</td>
                        <td className="num">{num(f.avg_reach)}</td>
                        <td className="num muted">{num(f.avg_interactions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {d.social.notes.length ? (
            <div className="note stack" style={{ gap: 6 }}>
              {d.social.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- the work report ---- */}
      {d.worked ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>Work</h3>
            <span className="muted small">What is on the board, what is finished, and where the hours sit</span>
          </div>

          <div className="stat-row">
            <div className="stat"><b>{d.worked.open}</b><span>still open</span></div>
            <div className="stat"><b>{d.worked.late || "—"}</b><span>past their date</span></div>
            <div className="stat"><b>{hrs(d.worked.judged_minutes)}</b><span>judged as a person&rsquo;s job or Circuit&rsquo;s</span></div>
            <div className="stat"><b>{hrs(d.worked.could_automate_minutes)}</b><span>of that, Circuit could take over</span></div>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Area</th><th className="num">Open</th><th className="num">Done</th><th className="num">Late</th><th className="num">Hours</th></tr></thead>
              <tbody>
                {d.worked.by_area.map((a) => (
                  <tr key={a.area}>
                    <td className="strong">{a.area}</td>
                    <td className="num">{a.open || "—"}</td>
                    <td className="num muted">{a.done || "—"}</td>
                    <td className="num">{a.late ? <span className="bad-text">{a.late}</span> : "—"}</td>
                    <td className="num muted">{hrs(a.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d.worked.months.some((m) => m.done) ? (
            <div className="ig-chart">
              <span className="eyebrow">Work finished each month</span>
              <LineChart unit="finished"
                points={d.worked.months.map((m): Point => ({ label: m.label, value: m.done, note: m.areas || "" }))} />
            </div>
          ) : null}

          {d.worked.notes.length ? (
            <div className="note stack" style={{ gap: 6 }}>
              {d.worked.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>Planned here, and the books</h3>
          <span className="small muted">
            What was planned in Circuit and what Circuit recorded against it — a different question from the
            account&rsquo;s own history above. Latest first.
          </span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Month</th>
                <th className="num">Planned</th><th className="num">Posted</th><th className="num">Reach</th>
                <th className="num">Likes</th><th className="num">Comments</th><th className="num">Engagement</th>
                <th className="num">Briefings</th><th className="num">Work done</th>
                {d.can_see_money !== false ? <><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Net</th></> : null}
              </tr></thead>
              <tbody>
                {rows.map((m, i) => {
                  const before = rows[i + 1];
                  return (
                    <tr key={m.month}>
                      <td className="strong">
                        {monthLabel(m.month)}
                        {before && d.can_see_money !== false ? <span className="sub"><Delta now={m.pnl.net} before={before.pnl.net} /> net</span> : null}
                      </td>
                      <td className="num muted">{m.posts || "—"}</td>
                      <td className="num">{m.posted || "—"}</td>
                      <td className="num">{m.reach ? m.reach.toLocaleString("en-IN") : "—"}</td>
                      <td className="num muted">{m.likes || "—"}</td>
                      <td className="num muted">{m.comments || "—"}</td>
                      <td className="num">{m.engagement ? `${m.engagement}%` : "—"}</td>
                      <td className="num muted">{m.briefings || "—"}</td>
                      <td className="num muted">{m.tasks_done || "—"}</td>
                      {d.can_see_money !== false ? <>
                      <td className="num">{m.pnl.revenue ? money(m.pnl.revenue) : "—"}</td>
                      <td className="num muted">{m.pnl.costs ? money(m.pnl.costs) : "—"}</td>
                      <td className={`num strong ${m.pnl.net < 0 ? "bad-text" : ""}`}>{m.pnl.revenue || m.pnl.costs ? money(m.pnl.net) : "—"}</td>
                      </> : null}
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
