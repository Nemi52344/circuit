"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, postJson, fmtDate, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, useToast, statusTone } from "@/components/ui";
import { WhatWorks } from "@/components/Working";
import { PosterInsights } from "@/components/Posters";
import type { Post, Metric } from "@/lib/types";

const n = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toLocaleString("en-IN"));
const sum = (arr: (number | null | undefined)[]) => { const vals = arr.filter((v): v is number => typeof v === "number"); return vals.length ? vals.reduce((a, b) => a + b, 0) : null; };

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Analytics />
    </Suspense>
  );
}

function Analytics() {
  const params = useSearchParams();
  const { push, view } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [target, setTarget] = useState<Post | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [p, m] = await Promise.all([api<Post[]>("/api/posts"), api<Metric[]>("/api/metrics")]);
    setPosts(p);
    setMetrics(m);
    const want = params.get("post");
    if (want) setTarget(p.find((x) => x.id === want) || null);
  };
  useEffect(() => {
    load().catch((e: Error) => push(e.message, "bad"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest = useMemo(() => {
    const map = new Map<string, Metric>();
    for (const m of metrics) if (!map.has(m.post_id)) map.set(m.post_id, m);
    return map;
  }, [metrics]);
  const posted = posts.filter((p) => p.status === "posted");
  const byPlatform = useMemo(() => {
    const groups = new Map<string, { posts: number; withData: number; impressions: (number | null)[]; reach: (number | null)[]; eng: (number | null)[]; clicks: (number | null)[] }>();
    for (const p of posted) {
      const g = groups.get(p.platform) || { posts: 0, withData: 0, impressions: [], reach: [], eng: [], clicks: [] };
      g.posts += 1;
      const m = latest.get(p.id);
      if (m) { g.withData += 1; g.impressions.push(m.impressions); g.reach.push(m.reach); g.eng.push(sum([m.likes, m.comments, m.shares])); g.clicks.push(m.clicks); }
      groups.set(p.platform, g);
    }
    return Array.from(groups.entries());
  }, [posted, latest]);

  const record = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!target) return;
    const fd = new FormData(e.currentTarget);
    const body: Record<string, FormDataEntryValue | string> = { post_id: target.id };
    for (const k of ["source", "period", "impressions", "reach", "likes", "comments", "shares", "clicks", "notes"]) body[k] = fd.get(k) ?? "";
    setBusy(true);
    try {
      await postJson("/api/metrics", body);
      push("Snapshot recorded", "ok");
      setTarget(null);
      await load();
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const removeMetric = async (id: string) => {
    if (!confirm("Delete this snapshot?")) return;
    await api(`/api/metrics?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Results</h2>
          <p className="lede">How your posts did, and what that says about what to make next. Instagram numbers come in by themselves; other platforms are typed in.</p>
        </div>
        <Pill tone="info">{posted.length} planned here and posted · {latest.size} with numbers against them</Pill>
      </div>

      <WhatWorks push={push} />
      <PosterInsights push={push} />

      <div className="cols-4">
        {byPlatform.length ? byPlatform.map(([platform, g]) => {
          const imp = sum(g.impressions); const eng = sum(g.eng);
          return (
            <div key={platform} className="kpi">
              <small>{platform} · {g.withData}/{g.posts} posts with data</small>
              <strong>{n(imp)}</strong>
              <span>impressions · reach {n(sum(g.reach))} · clicks {n(sum(g.clicks))}{imp && eng !== null ? ` · engagement ${((eng / imp) * 100).toFixed(1)}%` : ""}</span>
            </div>
          );
        }) : <div className="kpi"><small>No posted items yet</small><strong>n/a</strong><span>Mark a post as posted with its URL in the Calendar.</span></div>}
      </div>

      <section className="panel">
        <div className="panel-head"><h3>Posted items</h3><Link className="btn small" href="/calendar">Calendar</Link></div>
        {posted.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Platform</th><th>Caption</th><th>Source / period</th><th className="num">Impr.</th><th className="num">Reach</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Clicks</th><th className="num">Eng. rate</th><th /></tr></thead>
              <tbody>
                {posted.sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)).map((p) => {
                  const m = latest.get(p.id);
                  const eng = m ? sum([m.likes, m.comments, m.shares]) : null;
                  const rate = m && m.impressions && eng !== null ? `${((eng / m.impressions) * 100).toFixed(1)}%` : "n/a";
                  return (
                    <tr key={p.id}>
                      <td>{fmtDay(p.scheduled_at)}</td>
                      <td><Pill tone={statusTone(p.status)}>{p.platform}</Pill></td>
                      <td style={{ maxWidth: 260 }}>{p.caption ? p.caption.slice(0, 80) : <span className="muted">no caption</span>}{p.posted_url ? <> · <a href={p.posted_url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>live</a></> : null}</td>
                      <td>{m ? `${m.source}${m.period ? ` · ${m.period}` : ""}` : <span className="muted">not recorded</span>}</td>
                      <td className="num">{n(m?.impressions)}</td><td className="num">{n(m?.reach)}</td><td className="num">{n(m?.likes)}</td><td className="num">{n(m?.comments)}</td><td className="num">{n(m?.clicks)}</td><td className="num">{rate}</td>
                      <td><button className="btn small" type="button" onClick={() => setTarget(p)}>{m ? "New snapshot" : "Record"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No posted items" hint="Once a post is live, set it to posted with the URL in the Calendar, then record its numbers here." />
        )}
      </section>

      {metrics.length ? (
        <section className="panel">
          <div className="panel-head"><h3>All snapshots</h3><span className="muted small">Newest first. Each snapshot keeps its own source and period so totals stay reproducible.</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Collected</th><th>Post</th><th>Source</th><th>Period</th><th className="num">Impr.</th><th className="num">Reach</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Shares</th><th className="num">Clicks</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDate(m.collected_at)}</td><td>{m.platform} · {m.scheduled_at ? fmtDay(m.scheduled_at) : ""}</td><td>{m.source}</td><td>{m.period || "n/a"}</td>
                    <td className="num">{n(m.impressions)}</td><td className="num">{n(m.reach)}</td><td className="num">{n(m.likes)}</td><td className="num">{n(m.comments)}</td><td className="num">{n(m.shares)}</td><td className="num">{n(m.clicks)}</td>
                    <td>{m.notes}</td><td><button className="btn small ghost" type="button" onClick={() => removeMetric(m.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {target ? (
        <Modal title={`Record metrics: ${target.platform} · ${fmtDay(target.scheduled_at)}`} onClose={() => setTarget(null)}>
          <form onSubmit={record} className="stack">
            <div className="form-grid">
              <label className="field"><span>Source</span><input className="input" name="source" defaultValue={`${target.platform} insights`} /></label>
              <label className="field"><span>Period</span><input className="input" name="period" placeholder="first 24h / 7 days / lifetime" /></label>
              {["impressions", "reach", "likes", "comments", "shares", "clicks"].map((k) => <label key={k} className="field"><span style={{ textTransform: "capitalize" }}>{k}</span><input className="input" name={k} type="number" min={0} placeholder="leave blank if not available" /></label>)}
              <label className="field full"><span>Notes</span><input className="input" name="notes" placeholder="Boosted? Story reshare? Anything that explains the number." /></label>
            </div>
            <div className="actions"><button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save snapshot"}</button><button className="btn ghost" type="button" onClick={() => setTarget(null)}>Cancel</button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
