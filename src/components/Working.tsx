"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDay } from "@/lib/api";
import { Pill } from "@/components/ui";

/* What has worked for BNC, read from our own posted results rather than from the category.
   It says "not enough yet" until a group has three posts behind it, because advice from one
   post is worse than no advice. */

type Cut = { key: string; label: string; posts: number; engagement: number; reach: number | null; best: string; enough: boolean };
type OwnPost = { ig_id: string; permalink: string; type: string; caption: string; posted_at: string; likes: number; comments: number; reach: number | null; saved: number | null; shares: number | null };
type Standout = { permalink: string; type: string; caption: string; posted_at: string; engagement: number; reach: number | null; times: number };
type Learned = {
  posts: number; from: string; to: string; headline: string; advice: string[];
  pillars: Cut[]; formats: Cut[]; platforms: Cut[]; weekdays: Cut[];
  own_posts: number; own_formats: Cut[]; own_weekdays: Cut[]; own_standouts: Standout[]; own_average: number;
  own: OwnPost[]; last_sync: { at: string; read: number; stored: number; matched: number; errors: string[] } | null;
};

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-IN"));

function CutTable({ title, cuts }: { title: string; cuts: Cut[] }) {
  if (!cuts.length) return <div className="work-cut"><h4>{title}</h4><p className="small muted">Nothing posted under this yet.</p></div>;
  const top = Math.max(...cuts.map((c) => c.engagement), 1);
  return (
    <div className="work-cut">
      <h4>{title}</h4>
      <ul>
        {cuts.map((c) => (
          <li key={c.key} className={c.enough ? "" : "thin"}>
            <span className="name" title={c.best ? `Best: ${c.best}` : ""}>{c.label}</span>
            <span className="bar"><i style={{ width: `${Math.max(4, Math.round((c.engagement / top) * 100))}%` }} /></span>
            <span className="num">{n(c.engagement)}<small>{c.posts} post{c.posts === 1 ? "" : "s"}{c.enough ? "" : " · thin"}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatWorks({ push }: { push: (t: string, tone?: string) => void }) {
  const [d, setD] = useState<Learned | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Learned>("/api/performance").then(setD).catch(() => null), []);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await postJson<Learned>("/api/performance", { action: "sync" });
      setD(r);
      const s = r.last_sync;
      push(s?.errors.length ? s.errors[0] : `Read ${s?.stored || 0} of our posts, ${s?.matched || 0} matched to Circuit`, s?.errors.length ? "bad" : "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>What&apos;s working for us</h3>
        <span className="actions">
          {d ? <Pill tone={d.own_posts || d.posts ? "ok" : "warn"}>{d.own_posts ? `${d.own_posts} posts read` : `${d.posts} with numbers`}</Pill> : null}
          <button className="btn small primary" type="button" disabled={busy} onClick={sync}>{busy ? "Reading…" : "Get my numbers"}</button>
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{d?.headline || "Reading…"}</p>
      {d?.advice.length ? (
        <ul className="work-advice">{d.advice.map((a) => <li key={a}>{a}</li>)}</ul>
      ) : null}
      {d?.own_posts ? (
        <div className="work-grid">
          <CutTable title={`Your formats · ${d.own_posts} posts`} cuts={d.own_formats} />
          <CutTable title="Your posting days" cuts={d.own_weekdays} />
        </div>
      ) : null}
      {d?.own_standouts?.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Posts that beat your average ({d.own_average} interactions)</div>
          <ul className="standouts">
            {d.own_standouts.map((s) => (
              <li key={s.permalink}>
                <Pill tone="ok">{s.times}×</Pill>
                <span className="who">{s.type} · {s.posted_at ? fmtDay(s.posted_at) : ""}</span>
                <span className="cap" title={s.caption}>{s.caption}</span>
                <span className="num">{s.engagement.toLocaleString("en-IN")}{s.reach ? ` · ${s.reach.toLocaleString("en-IN")} reach` : ""}</span>
                {s.permalink ? <a className="btn small ghost" href={s.permalink} target="_blank" rel="noreferrer">See it ↗</a> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d ? (
        <details className="more">
          <summary>Posts planned in Circuit, by pillar and platform ›</summary>
          <div className="work-grid" style={{ marginTop: 10 }}>
            <CutTable title="By pillar" cuts={d.pillars} />
            <CutTable title="By format" cuts={d.formats} />
            <CutTable title="By platform" cuts={d.platforms} />
            <CutTable title="By day" cuts={d.weekdays} />
          </div>
        </details>
      ) : null}
      {d?.own?.length ? (
        <details className="more">
          <summary>Our last {d.own.length} Instagram posts, straight from Instagram ›</summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Posted</th><th>Type</th><th>Caption</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Saves</th></tr></thead>
              <tbody>
                {d.own.map((o) => (
                  <tr key={o.ig_id}>
                    <td>{o.posted_at ? fmtDay(o.posted_at) : "—"}</td>
                    <td>{o.type}</td>
                    <td title={o.caption}>{(o.caption || "").slice(0, 60) || "—"}</td>
                    <td>{n(o.reach)}</td>
                    <td>{o.likes.toLocaleString("en-IN")}</td>
                    <td>{o.comments.toLocaleString("en-IN")}</td>
                    <td>{n(o.saved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {d?.last_sync?.errors.length ? <div className="note bad"><strong>Couldn&apos;t read our numbers</strong>{d.last_sync.errors[0]}</div> : null}
    </section>
  );
}
