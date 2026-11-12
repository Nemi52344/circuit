"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { Delta } from "@/components/Sheet";
import { money, moneyShort, monthLabel } from "@/lib/money";
import type { MonthRow, Headline, SocialReport, WorkReport } from "@/lib/reports";
import { LineChart, type Point } from "@/components/Chart";

/* Reports: every report as a box, the detail behind each one a click away.

   Nothing here is entered. Every figure already lives somewhere else in Circuit — the calendar,
   Instagram's numbers, the bills, the salary list, the board — and this page only lines them
   up. Each box carries the one number that matters, how it moved, and its shape over the
   months; the side sheet it opens holds the tables. If a number looks wrong, it is wrong at
   its source, and that is where to fix it. */

type TeamRow = { id: string; name: string; open: number; late: number; done_month: number; done_all: number };
type Data = {
  months: MonthRow[]; headlines: Headline[];
  ahead: { n: number; first: string | null; last: string | null };
  /* Absent for anyone who does not run the spend — the server leaves it out. */
  admin: { unpaid: number; unpaid_value: number; overdue: number; items: number; stock_value: number; low: number } | null;
  /* Whether this account may see revenue, cost and net. When false the server has already
     zeroed them, and the money box is left off rather than shown as zeros. */
  can_see_money?: boolean;
  work: { total: number; doing: number; blocked: number; late: number; done_this_month: number };
  social: SocialReport;
  worked: WorkReport;
  team: TeamRow[];
  signoff: number;
  library: { photos: number; product: number; videos: number; brochures: number; inspiration: number; made: number };
};

type Key = "money" | "social" | "reach" | "engagement" | "content" | "work" | "team" | "admin" | "library" | "intel";

const hrs = (m: number) => (m >= 60 ? `${Math.round(m / 60)}h` : m ? `${m}m` : "—");
const num = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "—" : v.toLocaleString("en-IN"));
const pct = (now: number, before: number): number | null => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);

/* The shape of a number over the months, small enough to sit in a box. */
function Spark({ values, tone = "" }: { values: number[]; tone?: string }) {
  if (values.length < 2 || values.every((v) => !v)) return <div className="rp-spark is-flat" aria-hidden="true" />;
  const max = Math.max(...values), min = Math.min(0, ...values);
  const span = max - min || 1;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - ((v - min) / span) * 26 - 2]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className={`rp-spark ${tone}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,32 ${line} 100,32`} className="rp-spark-fill" />
      <polyline points={line} className="rp-spark-line" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="1.8" className="rp-spark-dot" />
    </svg>
  );
}

/* ↑ 12% on Sep — or nothing, when there is no month before to compare with. */
function Move({ delta, on, good = "up" }: { delta: number | null; on: string; good?: "up" | "down" }) {
  if (delta === null) return <span className="rp-move">no month before to compare</span>;
  const tone = delta === 0 ? "" : (delta > 0) === (good === "up") ? "is-good" : "is-bad";
  return <span className={`rp-move ${tone}`}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta)}% on {on}</span>;
}

function Tile({ k, eyebrow, big, label, children, spark, onOpen, tone = "" }: {
  k: Key; eyebrow: string; big: string; label: string; children?: React.ReactNode; spark?: React.ReactNode; onOpen: (k: Key) => void; tone?: string;
}) {
  return (
    <button type="button" className={`rp-tile ${tone}`} onClick={() => onOpen(k)} aria-label={`${eyebrow}: ${big} ${label}. Open the detail`}>
      <span className="rp-eyebrow">{eyebrow}</span>
      <span className="rp-big">{big}<small>{label}</small></span>
      <span className="rp-body">{children}</span>
      {spark}
      <span className="rp-more">See the detail →</span>
    </button>
  );
}

function Sheet({ title, sub, onClose, children }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className="rp-sheet" role="dialog" aria-label={title}>
        <div className="rp-sheet-head">
          <div><h3>{title}</h3>{sub ? <p className="small muted">{sub}</p> : null}</div>
          <button type="button" className="tb-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </aside>
    </>
  );
}

export default function ReportsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [months, setMonths] = useState(12);
  const [open, setOpenState] = useState<Key | null>(null);
  /* Which line the social chart draws. Posts, reach and engagement answer different questions
     and do not belong on one axis. */
  const [socialLine, setSocialLine] = useState<"posts" | "reach" | "engagement">("posts");
  const [moneyLine, setMoneyLine] = useState<"net" | "revenue" | "costs">("net");
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>(`/api/reports?months=${months}`).then(setD).catch((e: Error) => push(e.message, "bad")), [push, months]);
  useEffect(() => { load(); }, [load]);

  /* The open report lives in the address (?r=social), so a detail can be linked to and the
     back button closes it. */
  const setOpen = useCallback((k: Key | null) => {
    setOpenState(k);
    if (k === "reach" || k === "engagement") setSocialLine(k);
    else if (k === "social") setSocialLine("posts");
    const u = new URL(window.location.href);
    if (k) u.searchParams.set("r", k); else u.searchParams.delete("r");
    window.history.replaceState(null, "", u.toString());
  }, []);
  const close = useCallback(() => setOpen(null), [setOpen]);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("r") as Key | null;
    if (r) setOpen(r);
  }, [setOpen]);

  if (!d) return <p className="muted">Loading…</p>;
  const rows = [...d.months].reverse();
  const cur = d.months[d.months.length - 1];
  const prev = d.months[d.months.length - 2];
  const on = prev ? monthLabel(prev.month) : "last month";
  const head = (k: string) => d.headlines.find((h) => h.key === k);
  const sm = d.social?.months || [];
  const sNow = sm[sm.length - 1];
  const sPrev = sm[sm.length - 2];
  const sOn = sPrev ? sPrev.label : "last month";
  const showMoney = d.can_see_money !== false;
  const peakReach = Math.max(1, ...d.months.map((m) => m.reach));
  const teamOpen = d.team.reduce((a, t) => a + t.open, 0);
  const peakOpen = Math.max(1, ...d.team.map((t) => t.open));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="lede">
            Every report in one place — the number that matters, how it moved, its shape over the months. Click a box for
            the detail behind it. Nothing is typed here; it all comes from the calendar, Instagram, the board and{" "}
            <Link href="/money" style={{ textDecoration: "underline" }}>Money</Link>.
          </p>
        </div>
        <span className="actions">
          <select className="input" aria-label="How many months to report on" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ minHeight: 38, width: "auto" }}>
            <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option>
          </select>
        </span>
      </div>

      <div className="rp-grid">

        <Tile k="social" eyebrow="Social media" big={String(sNow?.posts ?? 0)} label={`posts in ${sNow?.label || "this month"}`} onOpen={setOpen}
          spark={<Spark values={sm.slice(-months).map((m) => m.posts)} />}>
          <span>{d.social?.totals.posts || 0} posts since {d.social?.from || "—"}</span>
          <Move delta={sNow && sPrev ? pct(sNow.posts, sPrev.posts) : null} on={sOn} />
        </Tile>

        <Tile k="reach" eyebrow="Reach" big={num(sNow?.reach) === "—" ? "0" : num(sNow?.reach)} label="people reached" onOpen={setOpen}
          spark={<Spark values={sm.slice(-months).map((m) => m.reach)} />}>
          <span>{sNow?.avg_reach ? `${num(sNow.avg_reach)} a post on average` : "Instagram has not sent figures for this month yet"}</span>
          <Move delta={sNow && sPrev ? pct(sNow.reach, sPrev.reach) : null} on={sOn} />
        </Tile>

        <Tile k="engagement" eyebrow="Engagement" big={`${sNow?.engagement ?? 0}%`} label="of reach interacted" onOpen={setOpen}
          spark={<Spark values={sm.slice(-months).map((m) => m.engagement || 0)} />}>
          <span>{num(sNow?.interactions)} likes, comments and saves</span>
          <Move delta={sNow && sPrev && sNow.engagement !== null && sPrev.engagement !== null ? pct(sNow.engagement, sPrev.engagement) : null} on={sOn} />
        </Tile>

        <Tile k="content" eyebrow="Content pipeline" big={String(d.signoff)} label="waiting for sign-off" onOpen={setOpen} tone={d.signoff ? "is-warn" : ""}
          spark={<Spark values={d.months.map((m) => m.posted)} />}>
          <span>{d.ahead?.n || 0} booked ahead · {cur?.posted || 0} out this month</span>
          <Move delta={head("posted")?.delta ?? null} on={on} />
        </Tile>

        <Tile k="work" eyebrow="Work" big={String(d.worked?.open ?? d.work.total)} label="open on the board" onOpen={setOpen} tone={d.work.late ? "is-warn" : ""}
          spark={<Spark values={(d.worked?.months || []).map((m) => m.done)} />}>
          <span>{d.work.late ? <b className="bad-text">{d.work.late} past their date</b> : "Nothing past its date"} · {d.work.done_this_month} finished this month</span>
          <span className="rp-move">{d.work.doing} on the go{d.work.blocked ? ` · ${d.work.blocked} blocked` : ""}</span>
        </Tile>

        <Tile k="team" eyebrow="Team" big={String(teamOpen)} label="open across the team" onOpen={setOpen}>
          <span className="rp-people">
            {d.team.slice(0, 4).map((t) => (
              <span key={t.id || "nobody"} className="rp-person">
                <b>{t.name.split(" ")[0]}</b>
                <i><em style={{ width: `${(t.open / peakOpen) * 100}%` }} /></i>
                <span>{t.open}{t.late ? <span className="bad-text"> · {t.late} late</span> : null}</span>
              </span>
            ))}
            {!d.team.length ? <span>Nobody takes work yet — set it on Work</span> : null}
          </span>
        </Tile>

        {d.admin ? (
          <Tile k="admin" eyebrow="Bills and stock" big={moneyShort(d.admin.unpaid_value)} label="in unpaid bills" onOpen={setOpen} tone={d.admin.overdue ? "is-warn" : ""}>
            <span>{d.admin.unpaid} outstanding{d.admin.overdue ? <> · <b className="bad-text">{d.admin.overdue} overdue</b></> : ""}</span>
            <span className="rp-move">Stock {moneyShort(d.admin.stock_value)} · {d.admin.items} items{d.admin.low ? `, ${d.admin.low} at reorder` : ""}</span>
          </Tile>
        ) : null}

        <Tile k="library" eyebrow="Library" big={String(d.library.photos)} label="photographs of ours" onOpen={setOpen}>
          <span>{d.library.videos} videos · {d.library.brochures} brochures · {d.library.product} product photos</span>
          <span className="rp-move">{d.library.made} made in the Studio · {d.library.inspiration} references</span>
        </Tile>

        <Tile k="intel" eyebrow="Daily intel" big={String(cur?.briefings || 0)} label="briefings this month" onOpen={setOpen}
          spark={<Spark values={d.months.map((m) => m.briefings)} />}>
          <span>{d.months.reduce((a, m) => a + m.briefings, 0)} in the last {d.months.length} months</span>
          <Move delta={prev ? pct(cur?.briefings || 0, prev.briefings) : null} on={on} />
        </Tile>

        {showMoney && cur ? (
          <Tile k="money" eyebrow="Money" big={moneyShort(cur.pnl.net)} label="net this month" onOpen={setOpen} tone={cur.pnl.net < 0 ? "is-neg" : ""}
            spark={<Spark values={d.months.map((m) => m.pnl.net)} />}>
            <span>Revenue {moneyShort(cur.pnl.revenue)} · cost {moneyShort(cur.pnl.costs)}</span>
            <Move delta={head("costs")?.delta ?? null} on={on} good="down" />
          </Tile>
        ) : null}
      </div>

      {/* ---------------- the details ---------------- */}

      {open === "money" && showMoney ? (
        <Sheet title="Money" sub="Revenue, running cost and net, month by month — from Finance." onClose={close}>
          <div className="stat-row">
            {(["revenue", "costs", "net"] as const).map((k) => {
              const h = head(k);
              return h ? <div className="stat" key={k}><b>{moneyShort(h.value)}</b><span>{h.label}{h.delta !== null ? ` · ${h.delta > 0 ? "↑" : h.delta < 0 ? "↓" : "→"} ${Math.abs(h.delta)}%` : ""}</span></div> : null;
            })}
          </div>
          <div className="ig-chart">
            <div className="ig-chart-head">
              <span className="eyebrow">{moneyLine === "net" ? "Net each month" : moneyLine === "revenue" ? "Revenue each month" : "Running cost each month"}</span>
              <div className="seg">
                {(["net", "revenue", "costs"] as const).map((k) => (
                  <button key={k} type="button" className={`seg-btn ${moneyLine === k ? "on" : ""}`} aria-pressed={moneyLine === k} onClick={() => setMoneyLine(k)}>
                    {k === "net" ? "Net" : k === "revenue" ? "Revenue" : "Cost"}
                  </button>
                ))}
              </div>
            </div>
            <LineChart unit="₹" points={d.months.map((m): Point => ({ label: monthLabel(m.month), value: m.pnl[moneyLine] }))} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Month</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Net</th></tr></thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={m.month}>
                    <td className="strong">{monthLabel(m.month)}{rows[i + 1] ? <span className="sub"><Delta now={m.pnl.net} before={rows[i + 1].pnl.net} /> net</span> : null}</td>
                    <td className="num">{m.pnl.revenue ? money(m.pnl.revenue) : "—"}</td>
                    <td className="num muted">{m.pnl.costs ? money(m.pnl.costs) : "—"}</td>
                    <td className={`num strong ${m.pnl.net < 0 ? "bad-text" : ""}`}>{m.pnl.revenue || m.pnl.costs ? money(m.pnl.net) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link className="btn small" href="/money?tab=finance">Open Finance</Link>
        </Sheet>
      ) : null}

      {(open === "social" || open === "reach" || open === "engagement") ? (
        <Sheet title="Social media, month by month" onClose={close}
          sub={d.social?.months?.length ? <>Read from the account&rsquo;s own history — {d.social.totals.posts} posts across {d.social.totals.months} months with something in them, {d.social.from} to {d.social.to}.</> : "Nothing read from Instagram yet."}>
          {d.social?.months?.length ? (
            <>
              <div className="stat-row">
                <div className="stat"><b>{d.social.totals.posts}</b><span>posts published</span></div>
                <div className="stat"><b>{num(d.social.totals.reach)}</b><span>people reached</span></div>
                <div className="stat"><b>{num(d.social.totals.interactions)}</b><span>likes, comments and saves</span></div>
                <div className="stat"><b>{d.social.busiest ? d.social.busiest.posts : "—"}</b><span>most in one month{d.social.busiest ? ` · ${d.social.busiest.label}` : ""}</span></div>
              </div>
              <div className="ig-chart">
                <div className="ig-chart-head">
                  <span className="eyebrow">{socialLine === "posts" ? "Posts published each month" : socialLine === "reach" ? "People reached each month" : "Engagement rate each month"}</span>
                  <div className="seg">
                    {(["posts", "reach", "engagement"] as const).map((k) => (
                      <button key={k} type="button" className={`seg-btn ${socialLine === k ? "on" : ""}`} aria-pressed={socialLine === k} onClick={() => setSocialLine(k)}>
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
                          <tr key={f.label}><td className="strong">{f.label}</td><td className="num">{f.posts}</td><td className="num">{num(f.avg_reach)}</td><td className="num muted">{num(f.avg_interactions)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
              {d.social.notes.length ? <div className="note stack" style={{ gap: 6 }}>{d.social.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}</div> : null}
            </>
          ) : <Empty title="No Instagram history yet" hint="Once the account is connected its posts and reach line up here, month by month." />}
        </Sheet>
      ) : null}

      {open === "content" ? (
        <Sheet title="Content pipeline" sub="What was planned in Circuit and what came of it — a different question from the account's own history." onClose={close}>
          <div className="stat-row">
            <div className="stat"><b>{d.signoff}</b><span>posters waiting for sign-off</span></div>
            <div className="stat"><b>{d.ahead?.n || 0}</b><span>booked ahead{d.ahead?.last ? `, out to ${monthLabel(d.ahead.last.slice(0, 7))}` : ""}</span></div>
            <div className="stat"><b>{cur?.posted || 0}</b><span>out this month</span></div>
            <div className="stat"><b>{cur?.posts || 0}</b><span>planned this month</span></div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn small primary" href="/content">Open Content status</Link>
            <Link className="btn small" href="/calendar">Open the calendar</Link>
          </div>
          {rows.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Month</th><th className="num">Planned</th><th className="num">Posted</th><th className="num">Reach</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Engagement</th><th className="num">Work done</th></tr></thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.month}>
                      <td className="strong">{monthLabel(m.month)}</td>
                      <td className="num muted">{m.posts || "—"}</td>
                      <td className="num">{m.posted || "—"}</td>
                      <td className="num">{m.reach ? m.reach.toLocaleString("en-IN") : "—"}</td>
                      <td className="num muted">{m.likes || "—"}</td>
                      <td className="num muted">{m.comments || "—"}</td>
                      <td className="num">{m.engagement ? `${m.engagement}%` : "—"}</td>
                      <td className="num muted">{m.tasks_done || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div>
            <span className="eyebrow">Reach of what was posted from here, oldest to newest</span>
            <div className="mom" style={{ height: 70, marginTop: 8 }}>
              {d.months.map((m) => <i key={m.month} style={{ height: `${Math.max(2, (m.reach / peakReach) * 100)}%` }} title={`${monthLabel(m.month)} · ${m.reach.toLocaleString("en-IN")} reach`} />)}
            </div>
            <p className="small muted" style={{ margin: "8px 0 0" }}>Reach is read straight from Instagram against posts marked as posted. Months before it was connected stay empty, which is honest rather than broken.</p>
          </div>
        </Sheet>
      ) : null}

      {open === "work" && d.worked ? (
        <Sheet title="Work" sub="What is on the board, what is finished, and where the hours sit." onClose={close}>
          <div className="stat-row">
            <div className="stat"><b>{d.work.doing}</b><span>on the go</span></div>
            <div className="stat"><b>{d.work.blocked || "—"}</b><span>blocked</span></div>
            <div className="stat"><b className={d.work.late ? "bad-text" : ""}>{d.work.late || "—"}</b><span>past their date</span></div>
            <div className="stat"><b>{d.work.done_this_month}</b><span>finished this month</span></div>
          </div>
          <div className="stat-row">
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
              <LineChart unit="finished" points={d.worked.months.map((m): Point => ({ label: m.label, value: m.done, note: m.areas || "" }))} />
            </div>
          ) : null}
          {d.worked.notes.length ? <div className="note stack" style={{ gap: 6 }}>{d.worked.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}</div> : null}
          <Link className="btn small" href="/work">Open the board</Link>
        </Sheet>
      ) : null}

      {open === "team" ? (
        <Sheet title="Team" sub="Who is carrying what. Work goes to people by what they do — set it under Team on the Work page." onClose={close}>
          {d.team.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Late</th><th className="num">Done this month</th><th className="num">Done in all</th></tr></thead>
                <tbody>
                  {d.team.map((t) => (
                    <tr key={t.id || "nobody"}>
                      <td className="strong">{t.name}</td>
                      <td className="num">{t.open || "—"}</td>
                      <td className="num">{t.late ? <span className="bad-text">{t.late}</span> : "—"}</td>
                      <td className="num">{t.done_month || "—"}</td>
                      <td className="num muted">{t.done_all || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="Nobody takes work yet" hint="Open Work → Team and say who does what." />}
          <Link className="btn small" href="/work">Open the board</Link>
        </Sheet>
      ) : null}

      {open === "admin" && d.admin ? (
        <Sheet title="Bills and stock" sub="From Admin." onClose={close}>
          <div className="list">
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Bills unpaid</strong><p>{d.admin.unpaid} outstanding</p></div><span>{money(d.admin.unpaid_value)}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Overdue</strong></div><span className={d.admin.overdue ? "bad-text" : ""}>{d.admin.overdue}</span></div>
            <div className="list-item" style={{ gridTemplateColumns: "1fr auto" }}><div><strong>Stock on hand</strong><p>{d.admin.items} items{d.admin.low ? `, ${d.admin.low} at reorder` : ""}</p></div><span>{moneyShort(d.admin.stock_value)}</span></div>
          </div>
          <Link className="btn small" href="/money?tab=bills">Open Bills and stock</Link>
        </Sheet>
      ) : null}

      {open === "library" ? (
        <Sheet title="Library" sub="What there is to make content from — ours first, then the rest." onClose={close}>
          <div className="list">
            {[
              { label: "Our photographs", note: "The shoot and the product photos — free to publish", n: d.library.photos, href: "/library?tab=collateral" },
              { label: "Product photos", note: "Studio renders the Studio can use", n: d.library.product, href: "/library?tab=collateral" },
              { label: "Our video", note: "Raw footage the Studio can cut into reels", n: d.library.videos, href: "/library?tab=collateral" },
              { label: "Brochures, flyers and spec sheets", note: "Searchable, and quoted from when copy is written", n: d.library.brochures, href: "/library?tab=brochures" },
              { label: "Made in the Studio", note: "Posters and slides", n: d.library.made, href: "/library?tab=everything" },
              { label: "References", note: "Other brands' work — never posted as ours", n: d.library.inspiration, href: "/library?tab=inspiration" },
            ].map((r) => (
              <Link key={r.label} href={r.href} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><strong>{r.label}</strong><p>{r.note}</p></div><span>{r.n}</span>
              </Link>
            ))}
          </div>
        </Sheet>
      ) : null}

      {open === "intel" ? (
        <Sheet title="Daily intel" sub="Morning briefings read into Circuit, month by month." onClose={close}>
          <div className="ig-chart">
            <span className="eyebrow">Briefings each month</span>
            <LineChart unit="briefings" points={d.months.map((m): Point => ({ label: monthLabel(m.month), value: m.briefings }))} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Month</th><th className="num">Briefings</th></tr></thead>
              <tbody>{rows.map((m) => <tr key={m.month}><td className="strong">{monthLabel(m.month)}</td><td className="num">{m.briefings || "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <Link className="btn small" href="/intel">Open Daily intel</Link>
        </Sheet>
      ) : null}
    </div>
  );
}
