"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Globe } from "@/components/Globe";
import { LineChart, type Point } from "@/components/Chart";
import { moneyShort } from "@/lib/money";
import { fmtDate, fileUrl } from "@/lib/api";

type TopPost = {
  permalink: string; type: string; caption: string; posted_at: string;
  reach: number | null; likes: number; comments: number; saved: number; file_id: string | null; times: number | null;
};
type Ig = {
  posts: number; reach: number; average_reach: number | null; interactions: number;
  from: string; to: string; best: TopPost | null;
  formats: { label: string; posts: number; reach: number | null; engagement: number }[];
  trend: { recent: number; earlier: number; change: number } | null;
  days_since_last_post: number | null; note: string;
  months: { key: string; label: string; posts: number; avg_reach: number; best_reach: number; interactions: number; thin: boolean }[];
  points: { at: string; reach: number; type: string }[];
};

/* Big numbers are read at a glance, so they are shortened — but only above ten thousand, below
   which "5,266" is both shorter and exact. */
const big = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : v.toLocaleString("en-IN");

/* The front door.

   Every other page in Circuit answers one question. This one answers "where are
   we", and it has to do it in the time it takes to glance — so it is one
   sentence, one set of counted numbers, and a way into each part of the place.

   The numbers are counted from the database, never rounded up for effect. If the
   month has no revenue in it, it says so rather than showing a hopeful zero. */

type Data = {
  planned: number; ahead: number; posted: number; assets: number; known: number;
  briefings: number; competitors: number;
  work: { open: number; doing: number; late: number };
  /* Null for anyone without the Finance permission — the server leaves it out. */
  month: { revenue: number; costs: number; net: number } | null;
  last_intel: { at: string; date: string; items: number } | null;
  ig?: Ig;
};

const AREAS = [
  { href: "/", label: "Calendar", line: "The month, day by day — plan it, fill it, see what each post is waiting on.", k: "planned", unit: "posts planned" },
  { href: "/slots", label: "The queue", line: "Everything in hand, how far along it is, and what needs you next.", k: "ahead", unit: "booked ahead" },
  { href: "/intel", label: "Daily intel", line: "Ten verticals swept every morning, filed, and emailed out at 09:30.", k: "briefings", unit: "briefings kept" },
  { href: "/knowledge", label: "What we know", line: "What Circuit has learned from the market, our own numbers and our posters.", k: "known", unit: "things learned" },
  { href: "/library", label: "Library", line: "Every picture and video the brand owns, named and findable.", k: "assets", unit: "files held" },
  { href: "/inspiration", label: "Inspiration", line: "What competitors published, saved as it goes out.", k: "competitors", unit: "posts saved" },
];

export default function HomePage() {
  const [d, setD] = useState<Data | null>(null);
  const [noPic, setNoPic] = useState(false);
  /* Which line the chart is showing. Reach and interactions answer different questions — how
     far it travelled, and whether anybody cared — so they are not drawn on one axis. */
  const [line, setLine] = useState<"reach" | "interactions">("reach");
  useEffect(() => { api<Data>("/api/home").then(setD).catch(() => setD(null)); }, []);

  const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("en-IN"));

  return (
    <div className="stack home">
      <section className="hero-world">
        <div className="hw-copy">
          <span className="hw-eyebrow">BNC Motors · a division of Nemi</span>
          <h1>
            Every marketing job<br />in <em>one</em> place.
          </h1>
          <p>
            Planning, research, drafts, captions, approvals, publishing, the morning intelligence
            briefing, and the books behind all of it. One app on one Mac — nothing goes out without you.
          </p>
          <div className="actions">
            <Link className="btn primary" href="/">Open the month</Link>
            <Link className="btn" href="/slots">See what needs you</Link>
          </div>
          {d?.last_intel ? (
            <span className="hw-note">Last briefing {fmtDate(d.last_intel.at)} · {d.last_intel.items} items</span>
          ) : null}
        </div>
        <div className="hw-globe"><Globe /></div>
      </section>

      <section className="hw-strip">
        <div><strong>{n(d?.planned)}</strong><small>posts in the plan</small></div>
        <div><strong>{n(d?.work.open)}</strong><small>jobs on the board{d?.work.late ? ` · ${d.work.late} late` : ""}</small></div>
        <div><strong>{n(d?.briefings)}</strong><small>briefings archived</small></div>
        <div><strong>{n(d?.known)}</strong><small>things learned</small></div>
        <div>
          {/* The Admin sees the month's net; everyone else sees how many posts have gone out,
              which is the number this slot is worth to them. */}
          <strong>{d?.month ? (d.month.revenue || d.month.costs ? moneyShort(d.month.net) : "—") : n(d?.posted)}</strong>
          <small>{!d?.month ? "posts gone out" : !d.month.revenue && !d.month.costs ? "no books this month yet" : "net this month"}</small>
        </div>
      </section>

      {/* ---- how the account is actually doing ---- */}
      {d?.ig?.posts ? (
        <section className="panel stack ig-panel">
          <div className="panel-head">
            <h3>Instagram</h3>
            <span className="muted small">
              {d.ig.posts} posts, {fmtDate(d.ig.from).replace(/,.*/, "")} to {fmtDate(d.ig.to).replace(/,.*/, "")} ·{" "}
              <Link href="/analytics">the whole picture</Link>
            </span>
          </div>

          {/* The most important thing on this panel is how old it is, so it is at the top and
              not inferred from a date somebody has to do arithmetic on. */}
          {d.ig.note ? <div className="note warn small">{d.ig.note}</div> : null}

          <div className="ig-nums">
            <div><strong>{big(d.ig.reach)}</strong><small>people reached, all time</small></div>
            <div><strong>{big(d.ig.average_reach)}</strong><small>reached by the average post</small></div>
            <div><strong>{big(d.ig.interactions)}</strong><small>likes, comments and saves</small></div>
            <div>
              <strong className={d.ig.trend && d.ig.trend.change < 0 ? "down" : ""}>
                {d.ig.trend ? `${d.ig.trend.change > 0 ? "+" : ""}${d.ig.trend.change}%` : "—"}
              </strong>
              <small>{d.ig.trend ? "recent half against the half before" : "not enough history to compare"}</small>
            </div>
          </div>

          {/* ---- how reach has moved, month by month ---- */}
          {d.ig.months.length > 1 ? (
            <div className="ig-chart">
              <div className="ig-chart-head">
                <span className="eyebrow">{line === "reach" ? "Reach per post, by month" : "Interactions, by month"}</span>
                <div className="seg">
                  <button className={`seg-btn ${line === "reach" ? "on" : ""}`} type="button" aria-pressed={line === "reach"} onClick={() => setLine("reach")}>Reach</button>
                  <button className={`seg-btn ${line === "interactions" ? "on" : ""}`} type="button" aria-pressed={line === "interactions"} onClick={() => setLine("interactions")}>Interactions</button>
                </div>
              </div>
              <LineChart
                unit={line === "reach" ? "reached by the average post" : "likes, comments and saves"}
                points={d.ig.months.map((m): Point => ({
                  label: m.label,
                  value: line === "reach" ? m.avg_reach : m.interactions,
                  note: m.posts ? `${m.posts} post${m.posts === 1 ? "" : "s"}${line === "reach" && m.best_reach ? ` · best ${m.best_reach.toLocaleString("en-IN")}` : ""}` : "",
                  thin: m.thin,
                  empty: m.posts === 0,
                }))}
              />
              <p className="small muted">
                A hollow point is a month with fewer than three posts — its average is one good post wearing a
                trend&rsquo;s clothes. A break in the line is a month with nothing posted at all.
              </p>
            </div>
          ) : null}

          <div className="ig-split">
            {/* ---- the post that went furthest ---- */}
            {d.ig.best ? (
              <a className="ig-best" href={d.ig.best.permalink} target="_blank" rel="noreferrer">
                {/* A row can outlive its file — a picture deleted from the library, or a sync
                    that stored the post and never got the image. Rather than a blank square,
                    the box says so and the numbers beside it still stand. */}
                {d.ig.best.file_id && !noPic
                  ? <img src={fileUrl(d.ig.best.file_id)} alt="" onError={() => setNoPic(true)} />
                  : <span className="ig-best-nopic">picture not kept</span>}
                <div>
                  <span className="eyebrow">Most viewed{d.ig.best.times ? ` · ${d.ig.best.times}× the average` : ""}</span>
                  <strong>{big(d.ig.best.reach)} reached</strong>
                  <p>{d.ig.best.caption}{d.ig.best.caption.length >= 150 ? "…" : ""}</p>
                  <small>
                    {d.ig.best.type} · {fmtDate(d.ig.best.posted_at)} · {d.ig.best.likes} likes · {d.ig.best.comments} comments
                    {d.ig.best.saved ? ` · ${d.ig.best.saved} saved` : ""}
                  </small>
                </div>
              </a>
            ) : null}

            {/* ---- which format is earning its place ---- */}
            {d.ig.formats.length ? (
              <div className="ig-formats">
                <span className="eyebrow">What reaches furthest</span>
                {d.ig.formats.map((f) => {
                  const top = d.ig!.formats[0].reach || 1;
                  return (
                    <div key={f.label} className="ig-bar">
                      <span className="ig-bar-top"><b>{f.label}</b><i>{big(f.reach)}</i></span>
                      <span className="ig-bar-track"><i style={{ width: `${Math.max(4, ((f.reach || 0) / top) * 100)}%` }} /></span>
                      <small>{f.posts} posts · {f.engagement} interactions each</small>
                    </div>
                  );
                })}
                {/* The comparison is only worth making if it is big enough to act on. */}
                {d.ig.formats.length > 1 && d.ig.formats[0].reach && d.ig.formats[d.ig.formats.length - 1].reach
                  ? (() => {
                      const best = d.ig!.formats[0];
                      const worst = d.ig!.formats[d.ig!.formats.length - 1];
                      const times = Math.round(((best.reach || 0) / (worst.reach || 1)) * 10) / 10;
                      return times >= 1.3
                        ? <p className="small muted">A {best.label.toLowerCase()} reaches {times}× what a {worst.label.toLowerCase()} does. Worth more of them.</p>
                        : null;
                    })()
                  : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="hw-areas">
        {AREAS.map((a) => (
          <Link key={a.href + a.label} href={a.href} className="hw-area">
            <strong>{a.label}</strong>
            <p>{a.line}</p>
            <span className="hw-count">{n(d?.[a.k as keyof Data] as number)} <i>{a.unit}</i></span>
          </Link>
        ))}
      </section>
    </div>
  );
}
