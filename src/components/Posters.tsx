"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fileUrl } from "@/lib/api";
import { Pill, ImageViewer } from "@/components/ui";
import type { ViewerItem } from "@/components/ui";

/* What the posters that worked have in common — the picture itself, not the post around it. */

type Side = { label: string; posts: number; engagement: number; reach: number | null };
type Split = { key: string; label: string; a: Side; b: Side; times: number; winner: string; solid: boolean };
type Best = { ig_id: string; permalink: string; file_id: string | null; engagement: number; reach: number | null; times: number; subject: string; text_on_image: string };
type Learned = {
  tagged: number; untagged: number; left: number; average: number;
  splits: Split[]; advice: string[]; best: Best[];
  run?: { tagged: number; skipped: number; errors: string[] };
};

export function PosterInsights({ push }: { push: (t: string, tone?: string) => void }) {
  const [d, setD] = useState<Learned | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const load = useCallback(() => api<Learned>("/api/posters").then(setD).catch(() => null), []);
  useEffect(() => { load(); }, [load]);

  const look = async () => {
    setBusy(true);
    try {
      const r = await postJson<Learned>("/api/posters", { action: "tag", batch: 6 });
      setD(r);
      const run = r.run;
      push(run?.errors.length ? run.errors[0] : `Looked at ${run?.tagged || 0} poster${run?.tagged === 1 ? "" : "s"}. ${r.left} to go.`, run?.errors.length ? "bad" : "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const viewItems: ViewerItem[] = (d?.best || []).filter((b) => b.file_id).map((b) => ({
    id: b.ig_id,
    src: fileUrl(b.file_id as string),
    title: b.subject || "Poster",
    subtitle: `${b.times}× your average`,
    tags: [{ label: `${b.engagement.toLocaleString("en-IN")} interactions`, tone: "ok" }, ...(b.reach ? [{ label: `${b.reach.toLocaleString("en-IN")} reach` }] : [])],
    body: b.text_on_image ? `Words on the picture: ${b.text_on_image}` : "",
    links: b.permalink ? [{ label: "See it on Instagram", url: b.permalink }] : [],
  }));

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>What works in the picture</h3>
        <span className="actions">
          {d ? <Pill tone={d.advice.length ? "ok" : "warn"}>{d.tagged} posters read</Pill> : null}
          {d?.left ? <button className="btn small primary" type="button" disabled={busy} onClick={look}>{busy ? "Looking…" : `Look at 6 more (${d.left} left)`}</button> : null}
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        ChatGPT looks at each poster you have published and writes down what it shows — a rider or an empty bike, words or none, day or night, festive or everyday. Those are then compared against what each post actually earned. Nothing here is an opinion about the design; the ranking is your own numbers.
      </p>

      {d?.advice.length ? (
        <ul className="work-advice">{d.advice.map((a) => <li key={a}>{a}</li>)}</ul>
      ) : d && d.tagged < 6 ? (
        <div className="note small"><strong>Not enough read yet</strong>Press the button above a few times. Circuit needs at least three posters on each side of a comparison before it will call anything a pattern.</div>
      ) : null}

      {d?.splits.length ? (
        <div className="splits">
          {d.splits.map((s) => {
            const win = s.winner === s.a.label ? s.a : s.b;
            const lose = s.winner === s.a.label ? s.b : s.a;
            const top = Math.max(win.engagement, 1);
            return (
              <div key={s.key} className={`split ${s.solid ? "" : "thin"}`}>
                <div className="split-head"><strong>{s.label}</strong>{s.solid ? <Pill tone="ok">{s.times}×</Pill> : <span className="small muted">too few to call</span>}</div>
                {[win, lose].map((side) => (
                  <div key={side.label} className="split-row">
                    <span className="name">{side.label}</span>
                    <span className="bar"><i style={{ width: `${Math.max(4, Math.round((side.engagement / top) * 100))}%` }} /></span>
                    <span className="num">{side.engagement}<small>{side.posts} post{side.posts === 1 ? "" : "s"}</small></span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}

      {d?.best.length ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Your best posters</div>
          <div className="src-grid">
            {d.best.map((b, i) => (
              <div key={b.ig_id} className="src-card" onClick={() => b.file_id && setAt(i)} style={{ cursor: b.file_id ? "zoom-in" : "default" }}>
                <div className="pic">{b.file_id ? <img src={fileUrl(b.file_id)} alt={b.subject} loading="lazy" /> : <span className="small muted">No picture</span>}</div>
                <span className="match-tag">{b.times}×</span>
                <div className="meta">
                  <strong>{b.subject || "Poster"}</strong>
                  <span>{b.engagement.toLocaleString("en-IN")} interactions{b.reach ? ` · ${b.reach.toLocaleString("en-IN")} reach` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {d && d.untagged ? <p className="small muted" style={{ margin: 0 }}>{d.untagged} poster{d.untagged === 1 ? "" : "s"} not read yet. Each pass reads six, about half a minute, on your own ChatGPT plan.</p> : null}
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Your best posters" /> : null}
    </section>
  );
}
