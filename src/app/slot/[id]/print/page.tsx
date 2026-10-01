"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, fileUrl, fmtDate } from "@/lib/api";
import { type Slot, FORMAT_LABEL, niceDate } from "@/lib/slotui";

type Detail = {
  slot: Slot; samples: { id: string; title: string; file_id: string | null; platform: string }[];
  content: { platform: string; caption: string; meta: string; scheduled_at: string }[];
  final: { file_id: string } | null; posts: { platform: string; scheduled_at: string; status: string; posted_url: string }[];
};

/* Backup stage as a printable page: open it and use Print, then Save as PDF. */
export default function PrintSlot() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  useEffect(() => { api<Detail>(`/api/slots/${id}`).then(setD).catch(() => null); }, [id]);
  if (!d) return <p className="muted">Loading…</p>;
  const s = d.slot;
  const r = s.research || {};
  return (
    <article className="print-doc">
      <div className="no-print actions" style={{ marginBottom: 20 }}>
        <button className="btn primary" type="button" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <p className="muted">Content slot · {niceDate(s.date)} at {s.time}</p>
      <h2>{s.topic || "Untitled"}</h2>
      <p>{s.pillar_name || "No pillar"} · {FORMAT_LABEL[s.format]} · {s.platforms.join(", ")}</p>

      <h3>Research</h3>
      {r.angle ? <p><strong>Angle:</strong> {r.angle}</p> : null}
      {r.message ? <p><strong>Key message:</strong> {r.message}</p> : null}
      {r.summary_competitor || r.competitor ? <p><strong>Competitors:</strong> {r.summary_competitor || r.competitor}</p> : null}
      {r.summary_market || r.market ? <p><strong>Market:</strong> {r.summary_market || r.market}</p> : null}
      {r.summary_topic ? <p><strong>Riders:</strong> {r.summary_topic}</p> : null}
      {r.summary_trends || r.trends ? <p><strong>Trends:</strong> {r.summary_trends || r.trends}</p> : null}

      {d.final ? <><h3>Approved image</h3><img className="print-img" src={fileUrl(d.final.file_id)} alt="Approved" /></> : null}

      <h3>Platform copy</h3>
      {d.content.map((c) => {
        let meta: Record<string, string> = {};
        try { meta = JSON.parse(c.meta || "{}"); } catch { meta = {}; }
        return (
          <div key={c.platform} className="print-block">
            <h4>{c.platform}{c.scheduled_at ? ` · ${fmtDate(c.scheduled_at)}` : ""}</h4>
            {meta.title ? <p><strong>{meta.title}</strong></p> : null}
            <p style={{ whiteSpace: "pre-wrap" }}>{c.caption}</p>
            {meta.hashtags ? <p className="muted">{meta.hashtags}</p> : null}
          </div>
        );
      })}

      {d.samples.length ? <><h3>Samples used</h3><ul>{d.samples.map((x) => <li key={x.id}>{x.title} ({x.platform || "saved"})</li>)}</ul></> : null}
      {d.posts.length ? <><h3>Posts</h3><ul>{d.posts.map((p) => <li key={p.platform + p.scheduled_at}>{p.platform}: {p.status}{p.posted_url ? ` · ${p.posted_url}` : ""}</li>)}</ul></> : null}
    </article>
  );
}
