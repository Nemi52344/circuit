"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, postJson, fmtDay } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";

/* Everything Circuit has found out, with where it came from. Agents file here every day; the
   topic ideas, the research and the captions all read from it. Anything wrong can be removed,
   and nothing is stored without a source. */

type Fact = {
  id: string; kind: string; title: string; body: string; why: string;
  source_name: string; source_url: string; dated: string; confidence: string; tags: string;
  agent: string; seen_count: number; found_at: string;
};
type Kind = { key: string; label: string; note: string };
type Data = { facts: Fact[]; kinds: Kind[]; counts: { total: number; fresh: number; by_kind: Record<string, number> }; last_run: string };

export default function KnowledgePage() {
  const [d, setD] = useState<Data | null>(null);
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();

  const load = useCallback((k = kind) => api<Data>(`/api/knowledge?kind=${k}`).then(setD).catch((e: Error) => push(e.message, "bad")), [kind, push]);
  useEffect(() => { load(kind); }, [kind, load]);

  const learnNow = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ added: number; seen_again: number; agents: string[] }>("/api/knowledge", { action: "learn" });
      push(r.added ? `${r.added} new thing${r.added === 1 ? "" : "s"} learned` : "Nothing new this time", r.added ? "ok" : "");
      load(kind);
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const forget = async (f: Fact) => {
    if (!confirm(`Remove "${f.title.slice(0, 60)}"? It stops being used in ideas and research.`)) return;
    await api(`/api/knowledge?id=${f.id}`, { method: "DELETE" });
    load(kind);
  };

  if (!d) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>What Circuit knows</h2>
          <p className="lede">
            Everything the agents have found out about this market, each with its source. The topic ideas,
            the research and the captions all read from here, so the app gets better the longer it runs.
          </p>
        </div>
        <button className="btn primary" type="button" disabled={busy} onClick={learnNow}>{busy ? "Looking…" : "Go and learn now"}</button>
      </div>

      <div className="know-counts">
        <div className="kpi"><strong>{d.counts.total}</strong><small>things known</small><span>{d.counts.fresh} found this week</span></div>
        {d.kinds.filter((k) => d.counts.by_kind[k.key]).map((k) => (
          <button key={k.key} type="button" className={`kpi as-button ${kind === k.key ? "on" : ""}`} onClick={() => setKind(kind === k.key ? "all" : k.key)}>
            <strong>{d.counts.by_kind[k.key]}</strong><small>{k.label}</small><span>{k.note}</span>
          </button>
        ))}
      </div>

      {d.facts.length ? (
        <div className="stack" style={{ gap: 10 }}>
          {d.facts.map((f) => (
            <article key={f.id} className="fact">
              <div className="fact-top">
                <Pill tone={f.confidence === "high" ? "ok" : f.confidence === "low" ? "warn" : ""}>{d.kinds.find((k) => k.key === f.kind)?.label || f.kind}</Pill>
                {f.seen_count > 1 ? <Pill tone="ok">seen {f.seen_count}×</Pill> : null}
                <span className="small muted">{f.dated || fmtDay(f.found_at)}{f.agent ? ` · ${f.agent}` : ""}</span>
                <button className="btn small ghost" type="button" onClick={() => forget(f)}>Not true</button>
              </div>
              <strong>{f.title}</strong>
              {f.body ? <p>{f.body}</p> : null}
              {f.why ? <p className="why">Why it matters: {f.why}</p> : null}
              <div className="fact-foot">
                <a href={f.source_url} target="_blank" rel="noreferrer">{f.source_name || "source"} ↗</a>
                {f.tags ? <span className="small muted">{f.tags}</span> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={kind === "all" ? "Nothing learned yet" : "Nothing under this heading yet"}
          hint="Press Go and learn now, or leave it: the Keep learning routine runs every morning at 07:00."
        />
      )}

      <p className="small muted">
        Agents file here on their own every morning. See or change the routine in <Link href="/workflows" style={{ textDecoration: "underline" }}>Workflows</Link>.
        Nothing is stored without a source link, and the same fact found twice is counted, not duplicated.
      </p>
    </div>
  );
}
