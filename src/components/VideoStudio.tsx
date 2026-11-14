"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, postJson, fileUrl, fmtDate } from "@/lib/api";
import { useToast } from "@/components/ui";

/* The Video tab of the Studio: pick footage, say how long, press go. Circuit cuts the reel,
   captions it, puts the brand on it, writes the post and puts it on the calendar — each edit's
   progress shows below as it happens. */

type Video = { id: string; name: string; title: string | null; tags: string | null; size: number; kind: string; created_at: string };
type Job = { id: string; source_file_id: string; status: string; step: string; options: string; plan: string; output_file_id: string; post_id: string; error: string; created_at: string };
type Data = { jobs: Job[]; tools: { ffmpeg: boolean; whisper: boolean; chrome: boolean; chatgpt: boolean }; videos: Video[] };

const STEPS = ["Reading the footage", "Listening to what is said", "Looking at the footage", "ChatGPT is choosing the moments", "Drawing the captions and cards", "Cutting the reel", "Saving it"];
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

export function VideoStudio() {
  const { push, view } = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [pick, setPick] = useState<string>("");
  const [length, setLength] = useState(30);
  const [captions, setCaptions] = useState(true);
  const [brandmark, setBrandmark] = useState(true);
  const [endcard, setEndcard] = useState(true);
  const [brief, setBrief] = useState("");
  const [postOn, setPostOn] = useState(plusDays(1));
  const [platform, setPlatform] = useState("Instagram");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => api<Data>("/api/video").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);
  const working = d?.jobs.some((j) => j.status === "queued" || j.status === "working");
  useEffect(() => { const t = setInterval(load, working ? 2500 : 30000); return () => clearInterval(t); }, [working, load]);

  /* New footage goes straight into the collateral, tagged as ours. */
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    fd.append("kind", "raw"); fd.append("brand", "1"); fd.append("rights", "Ours, free to publish");
    setUploading(true);
    try {
      const r = await api<{ files: Video[] }>("/api/files", { method: "POST", body: fd });
      push(`Added ${r.files.length} video${r.files.length === 1 ? "" : "s"}`, "ok");
      if (r.files[0]) setPick(r.files[0].id);
      load();
    } catch (err) { push((err as Error).message, "bad"); } finally { setUploading(false); e.target.value = ""; }
  };

  const go = async () => {
    if (!pick) return push("Pick the footage first", "bad");
    setBusy(true);
    try {
      await postJson("/api/video", { source_file_id: pick, options: { length, captions, brandmark, endcard, brief, post_on: postOn, platform } });
      push("Editing — follow it below. It takes a minute or two.", "ok");
      setBrief("");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  if (!d) return <div className="wk-skeleton" />;
  const missing = [!d.tools.ffmpeg && "ffmpeg", !d.tools.chrome && "Chrome", !d.tools.whisper && "Whisper (captions)", !d.tools.chatgpt && "ChatGPT (choosing the moments)"].filter(Boolean);
  const chosen = d.videos.find((v) => v.id === pick);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {view}
      {missing.length ? <div className="note small">Not on this computer: {missing.join(", ")}. {d.tools.ffmpeg ? "Edits still run, without those parts." : "The video studio needs ffmpeg."}</div> : null}

      <section className="vs-grid">
        <div className="vs-pick">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong>1 · Footage</strong>
            <label className="btn small">{uploading ? "Uploading…" : "Upload video"}<input type="file" accept="video/*" multiple hidden onChange={upload} disabled={uploading} /></label>
          </div>
          <div className="vs-list">
            {d.videos.length ? d.videos.map((v) => (
              <button key={v.id} type="button" className={`vs-item ${pick === v.id ? "on" : ""}`} onClick={() => setPick(v.id)} aria-pressed={pick === v.id}>
                <video src={`${fileUrl(v.id)}#t=1`} preload="metadata" muted playsInline />
                <span><strong>{v.title || v.name}</strong><small>{v.kind === "raw" ? "Our collateral" : "Library"} · {mb(v.size)}</small></span>
              </button>
            )) : <p className="wk-empty">No videos yet — upload the footage from a shoot.</p>}
          </div>
        </div>

        <div className="vs-opts">
          <strong>2 · How to cut it</strong>
          {chosen ? <video className="vs-preview" src={fileUrl(chosen.id)} controls playsInline preload="metadata" /> : <div className="vs-preview empty">Pick footage on the left</div>}
          <div className="wk"><div className="seg" role="group" aria-label="Length">
            {[15, 30, 60].map((n) => <button key={n} type="button" className={length === n ? "on" : ""} onClick={() => setLength(n)}>{n} sec</button>)}
          </div></div>
          <div className="vs-toggles">
            <label className="wk-toggle"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Captions from the speech</label>
            <label className="wk-toggle"><input type="checkbox" checked={brandmark} onChange={(e) => setBrandmark(e.target.checked)} /> Brand name in the corner</label>
            <label className="wk-toggle"><input type="checkbox" checked={endcard} onChange={(e) => setEndcard(e.target.checked)} /> End card with a call to action</label>
          </div>
          <label className="field"><span>What it is about <em>optional — helps ChatGPT choose</em></span>
            <textarea className="textarea" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Customer story — Shubham rode from Agra. Keep it real and exciting." />
          </label>
          <div className="wk-drawer-grid">
            <label className="field"><span>Post on</span><input className="input" type="date" value={postOn} onChange={(e) => setPostOn(e.target.value)} /></label>
            <label className="field"><span>Where</span>
              <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>{["Instagram", "Facebook"].map((p) => <option key={p}>{p}</option>)}</select>
            </label>
          </div>
          <button type="button" className="btn primary" disabled={busy || !pick || !d.tools.ffmpeg} onClick={go}>{busy ? "Starting…" : `Edit into a ${length}-second reel`}</button>
          <p className="small muted" style={{ margin: 0 }}>Circuit picks the moments, captions it, brands it and writes the post. It lands on Content status for its day — videos need no sign-off, but nothing is published until someone presses Publish.</p>
        </div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Edits</h3>
        {d.jobs.length ? d.jobs.map((j) => {
          const plan = (() => { try { return JSON.parse(j.plan) as { hook?: string; caption?: string; hashtags?: string[]; cuts?: { start: number; end: number }[] }; } catch { return {}; } })();
          const opts = (() => { try { return JSON.parse(j.options) as { length: number; post_on: string; platform: string }; } catch { return { length: 0, post_on: "", platform: "" }; } })();
          const src = d.videos.find((v) => v.id === j.source_file_id);
          const at = STEPS.indexOf(j.step);
          return (
            <article key={j.id} className={`vs-job s-${j.status}`}>
              <div className="vs-job-media">
                {j.output_file_id ? <video src={fileUrl(j.output_file_id)} controls playsInline preload="metadata" /> : <div className="vs-job-wait">{j.status === "failed" ? "✕" : <i className="wk-spin" />}</div>}
              </div>
              <div className="vs-job-body">
                <strong>{plan.hook || (src ? src.title || src.name : "Reel")}</strong>
                <span className="small muted">{opts.length}s · {opts.platform} · post on {opts.post_on} · started {fmtDate(j.created_at)}</span>
                {j.status === "queued" || j.status === "working" ? (
                  <div className="vs-steps">{STEPS.map((s, i) => <span key={s} className={i < at ? "done" : i === at ? "now" : ""}>{s}</span>)}</div>
                ) : null}
                {j.status === "failed" ? <div className="wk-in-err">{j.error}</div> : null}
                {j.status === "done" && plan.caption ? <p className="vs-caption">{plan.caption}{plan.hashtags?.length ? `\n\n${plan.hashtags.map((h) => `#${h}`).join(" ")}` : ""}</p> : null}
                <div className="actions">
                  {j.status === "done" ? <Link className="btn small primary" href="/content">See it on Content status</Link> : null}
                  {j.status === "done" && j.output_file_id ? <a className="btn small ghost" href={fileUrl(j.output_file_id)} download>Download</a> : null}
                  {j.status === "failed" ? <button type="button" className="btn small" onClick={() => postJson("/api/video", { action: "retry", id: j.id }, "PATCH").then(load)}>Try again</button> : null}
                </div>
              </div>
            </article>
          );
        }) : <p className="wk-empty">No edits yet.</p>}
      </section>
    </div>
  );
}
