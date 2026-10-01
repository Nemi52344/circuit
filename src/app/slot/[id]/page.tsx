"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, postJson, fileUrl, fmtDate } from "@/lib/api";
import { Pill, Empty, ImageViewer, ViewableImage, useToast } from "@/components/ui";
import type { ViewerItem } from "@/components/ui";
import { type Slot, type Pillar, type NextStep, STAGE_LABELS, SLOT_PLATFORMS, FORMAT_LABEL, niceDate, relDay } from "@/lib/slotui";

type Insp = { id: string; title: string; file_id: string | null; competitor: string; platform: string; notes: string; source_url: string };
type Draft = { id: string; file_id: string; round: number; parent_id: string | null; status: string; model: string; created_at: string };
type Job = { id: string; status: string; round: number; model: string; error: string; creation_id: string | null; slide_id?: string | null };
type Content = { id: string; platform: string; caption: string; meta: string; scheduled_at: string; post_id: string | null };
type Post = { id: string; platform: string; scheduled_at: string; status: string; posted_url: string; caption: string };
type Product = { id: string; name: string; color: string; file_id: string };
type ResearchJob = { id: string; status: string; error: string; created_at: string; updated_at: string };
type Detail = {
  slot: Slot; samples: Insp[]; drafts: Draft[]; jobs: Job[]; content: Content[]; posts: Post[]; product: Product | null; final: Draft | null;
  research_job: ResearchJob | null; copy_job: ResearchJob | null; topics_job: { status: string } | null; poster_job?: string; next: NextStep;
  approvals: SignOff;
  slides: Slide[];
  slides_job: { status: string; error: string; created_at: string } | null;
};
type SignItem = { id: string; approver_id: string; name: string; role: string; email: string; required: boolean; status: "pending" | "approved" | "changes"; comment: string; token: string; decided_at: string; stale: boolean };
type SignOff = { approvers: number; required: number; approved: number; changes: number; pending: number; requested: boolean; ready: boolean; missing: string[]; items: SignItem[] };
type Model = { id: string; label: string; note: string };
type Brand = { name: string; tagline: string; tone: string; audience: string; claims: string };
type Push = (t: string, tone?: string) => void;

const TEXT_SKIPS = [3, 4, 5, 6];
const isOpen = (j?: { status: string } | null) => Boolean(j && (j.status === "queued" || j.status === "running"));
const stale = (j?: ResearchJob | null) => Boolean(j && j.status === "queued" && Date.now() - new Date(j.created_at).getTime() > 5 * 60 * 1000);

function ClaudeWaiting({ job, doing }: { job: ResearchJob | null; doing: string }) {
  if (stale(job)) {
    return (
      <div className="note bad">
        <strong>ChatGPT hasn&apos;t picked this up yet</strong>
        Check Settings: ChatGPT should say Signed in with Work automatically on. <a href="/settings" style={{ textDecoration: "underline" }}>Open Settings</a>
      </div>
    );
  }
  return <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>{job?.status === "running" ? `ChatGPT is ${doing}` : `Waiting for ChatGPT to start ${doing}`}</strong>Usually a couple of minutes. You can leave this page; it fills in by itself.</div>;
}

export default function SlotPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { push, view } = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [active, setActive] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>(`/api/slots/${id}`);
      setD(r);
      // open on the step that needs attention
      setActive((a) => a ?? Math.min(r.next.stage, r.slot.stage));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // while ChatGPT or a render is working, keep the page fresh
  const pending = Boolean(d && (d.jobs.some((j) => j.status === "queued" || j.status === "running") || isOpen(d.research_job) || isOpen(d.copy_job) || isOpen(d.topics_job)));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [pending, load]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    await postJson("/api/slots", { id, ...body }, "PATCH");
    await load();
  }, [id, load]);
  const goTo = useCallback(async (stage: number) => {
    if (d && stage > d.slot.stage) await patch({ stage });
    setActive(stage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [d, patch]);

  if (err) return <div className="note bad"><strong>Couldn&apos;t open this post</strong>{err} <Link href="/" style={{ textDecoration: "underline" }}>Back to calendar</Link></div>;
  if (!d || active === null) return <p className="muted">Loading…</p>;
  const s = d.slot;
  const isText = s.format === "text";

  return (
    <div className="stack">
      {view}
      <div className="slot-head">
        <Link href="/" className="back-link">‹ Calendar</Link>
        <h2>{s.topic || `New ${s.pillar_name ? `${s.pillar_name} ` : ""}post`}</h2>
        <p className="lede">{relDay(s.date)}{relDay(s.date) !== niceDate(s.date) ? `, ${niceDate(s.date)}` : ""} at {s.time} · {s.platforms.join(", ") || "No platform yet"}</p>
      </div>

      <nav className="stepper" aria-label="Steps">
        {STAGE_LABELS.map((label, i) => {
          const n = i + 1;
          const skipped = isText && TEXT_SKIPS.includes(n);
          const done = n < d.next.stage && !skipped;
          return (
            <button key={n} type="button" className={`step ${active === n ? "current" : ""} ${done ? "done" : ""} ${skipped ? "skipped" : ""}`} onClick={() => n <= Math.max(s.stage, 1) && setActive(n)} disabled={n > s.stage} aria-current={active === n ? "step" : undefined}>
              <span className="step-no">{done ? "✓" : n}</span>
              <span className="step-label">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="slot-layout">
        <div className="slot-main stack">
          {active === 1 ? <StageTopic d={d} patch={patch} load={load} next={() => goTo(2)} push={push} /> : null}
          {active === 2 ? <StageResearch d={d} patch={patch} next={(fmt) => goTo(fmt === "text" ? 7 : 3)} push={push} /> : null}
          {active === 3 ? (isText ? <Skipped next={() => goTo(7)} /> : <StageSamples d={d} load={load} next={() => goTo(4)} push={push} />) : null}
          {active === 4 ? (isText ? <Skipped next={() => goTo(7)} /> : <StageDraft d={d} load={load} next={() => goTo(5)} push={push} />) : null}
          {active === 5 ? (isText ? <Skipped next={() => goTo(7)} /> : <StageRefine d={d} load={load} patch={patch} next={() => goTo(6)} push={push} />) : null}
          {active === 6 ? (isText ? <Skipped next={() => goTo(7)} /> : <StageApprove d={d} patch={patch} next={() => goTo(7)} back={() => setActive(5)} push={push} />) : null}
          {active === 7 ? <StageContent d={d} load={load} next={() => goTo(8)} push={push} /> : null}
          {active === 8 ? <StageSchedule d={d} load={load} push={push} onDone={() => router.refresh()} /> : null}
        </div>
        <SlotAside d={d} active={active} go={(n) => { setActive(n); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      </div>
    </div>
  );
}

function SlotAside({ d, active, go }: { d: Detail; active: number; go: (n: number) => void }) {
  const s = d.slot;
  const r = s.research || {};
  const img = d.final?.file_id || d.drafts[d.drafts.length - 1]?.file_id;
  const n = d.next;
  return (
    <aside className="slot-aside">
      <div className={`next-card who-${n.who}`}>
        <small>{n.who === "claude" ? (/draft/i.test(n.label) ? "Drafts are being created" : "ChatGPT is on it") : n.who === "team" ? "Waiting on your team" : n.who === "done" ? "All done" : "Your next step"}</small>
        <strong>{n.label}</strong>
        {n.who !== "done" && active !== n.stage ? <button className="btn small primary" type="button" onClick={() => go(n.stage)}>Go to {STAGE_LABELS[n.stage - 1].toLowerCase()}</button> : null}
      </div>
      {img ? <div className="aside-img"><ViewableImage item={{ id: img, src: fileUrl(img), title: d.final ? "Final image" : "Latest draft", subtitle: s.topic || "" }} eyebrow="This post" alt={d.final ? "Final image" : "Latest draft"} /><small>{d.final ? "Final image" : "Latest draft"}</small></div> : null}
      <dl className="kv">
        <dt>When</dt><dd>{niceDate(s.date)} at {s.time}</dd>
        <dt>Pillar</dt><dd>{s.pillar_name || "Not set"}</dd>
        <dt>Platforms</dt><dd>{s.platforms.join(", ") || "Not set"}</dd>
        <dt>Format</dt><dd>{FORMAT_LABEL[s.format]}</dd>
        {r.angle ? <><dt>Angle</dt><dd>{r.angle}</dd></> : null}
        {r.message ? <><dt>Key message</dt><dd>&ldquo;{r.message}&rdquo;</dd></> : null}
      </dl>
      <div className="aside-links">
        <a href={`/api/slots/${s.id}/export`}>Export Markdown</a>
        <Link href={`/slot/${s.id}/print`} target="_blank">Print or PDF</Link>
        {d.final ? <a href={fileUrl(d.final.file_id)} download>Download image</a> : null}
      </div>
    </aside>
  );
}

function Skipped({ next }: { next: () => void }) {
  return (
    <section className="panel">
      <Empty title="Not needed for a text-only post" hint="Text posts go straight from research to the captions." />
      <div className="actions" style={{ marginTop: 14 }}><button className="btn primary" type="button" onClick={next}>Go to captions</button></div>
    </section>
  );
}

/* ---------- 1 · Topic ---------- */
function StageTopic({ d, patch, load, next, push }: { d: Detail; patch: (b: Record<string, unknown>) => Promise<void>; load: () => Promise<void>; next: () => void; push: Push }) {
  const s = d.slot;
  const r = (s.research || {}) as Record<string, unknown>;
  const claudeIdeas = (r.topic_ideas as { topic: string; why?: string; format?: string; hook?: string; conversation?: string; keywords?: string[] }[] | undefined) || [];
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [pillarId, setPillarId] = useState(s.pillar_id || "");
  const [addingPillar, setAddingPillar] = useState(false);
  const [newPillar, setNewPillar] = useState("");
  const [topic, setTopic] = useState(s.topic);
  const [platforms, setPlatforms] = useState<string[]>(s.platforms);
  const [date, setDate] = useState(s.date);
  const [time, setTime] = useState(s.time);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Pillar[]>("/api/pillars").then(setPillars).catch(() => null);
    api<Slot[]>("/api/slots").then((all) => setUsed(new Set(all.filter((x) => x.id !== s.id && x.topic).map((x) => x.topic.trim().toLowerCase())))).catch(() => null);
  }, [s.id]);

  const pillar = pillars.find((p) => p.id === pillarId);
  // the plan's own examples for this pillar, minus anything another post already uses
  const planIdeas = (pillar?.examples || []).filter((t) => !used.has(t.toLowerCase()));
  const choosePillar = (p: Pillar) => {
    setPillarId(p.id);
    if (!platforms.length && p.platforms.length) setPlatforms(p.platforms.filter((x) => SLOT_PLATFORMS.includes(x)));
  };
  const addPillar = async () => {
    if (!newPillar.trim()) return;
    const res = await postJson<{ id: string }>("/api/pillars", { name: newPillar });
    setNewPillar("");
    setAddingPillar(false);
    setPillars(await api<Pillar[]>("/api/pillars"));
    setPillarId(res.id);
  };
  const askChatGPT = async () => {
    await postJson("/api/slots/topics", { slot_id: s.id });
    push("Asked ChatGPT for topic ideas", "ok");
    load();
  };
  const finalize = async () => {
    if (!topic.trim()) return push("Pick or write a topic first", "bad");
    if (!platforms.length) return push("Pick at least one platform", "bad");
    setBusy(true);
    try {
      const changed = topic.trim() !== s.topic || !r.signals;
      const idea = claudeIdeas.find((i) => i.topic === topic.trim());
      await patch({ pillar_id: pillarId || null, topic: topic.trim(), platforms, date, time, status: "in_progress", ...(idea?.format ? { format: idea.format } : {}), ...(idea ? { research: { chosen_idea: idea, keywords: idea.keywords || [] } } : {}) });
      // research is automatic: start it now, don't make anyone press a button
      if (changed) void postJson(`/api/slots/${s.id}/research`, {}).catch(() => null);
      next();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}><h3>What is this post about?</h3></div>

      <div className="field"><span>Pillar</span>
        <div className="chips">
          {pillars.map((p) => <button key={p.id} type="button" className={`chip ${pillarId === p.id ? "on" : ""}`} onClick={() => choosePillar(p)} title={p.description}>{p.name}</button>)}
          {addingPillar ? (
            <span className="fetch-row" style={{ gap: 6 }}>
              <input className="input" autoFocus value={newPillar} onChange={(e) => setNewPillar(e.target.value)} placeholder="New pillar name" onKeyDown={(e) => e.key === "Enter" && addPillar()} style={{ width: 180 }} />
              <button className="btn small" type="button" onClick={addPillar}>Add</button>
            </span>
          ) : <button type="button" className="chip ghost-chip" onClick={() => setAddingPillar(true)}>+ New pillar</button>}
        </div>
        {pillar?.description ? <em className="hint">{pillar.description}</em> : null}
      </div>

      <div className="field"><span>Topic</span>
        {claudeIdeas.length ? (
          <div className="idea-grid">
            {claudeIdeas.map((i) => (
              <button key={i.topic} type="button" className={`idea ${topic === i.topic ? "on" : ""}`} onClick={() => setTopic(i.topic)} aria-pressed={topic === i.topic}>
                <span className="idea-top"><strong>{i.topic}</strong>{i.format ? <span className="pill">{FORMAT_LABEL[i.format]}</span> : null}</span>
                {i.hook ? <span className="idea-hook">&ldquo;{i.hook}&rdquo;</span> : null}
                {i.why ? <span>{i.why}</span> : null}
                {i.conversation ? <span className="idea-src">From: {i.conversation}</span> : null}
              </button>
            ))}
          </div>
        ) : isOpen(d.topics_job) ? (
          <ClaudeWaiting job={d.topics_job as ResearchJob} doing="suggesting topics" />
        ) : null}
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={claudeIdeas.length ? "Or write your own" : "Write a topic, for example: riding through the monsoon with confidence"} />
        {planIdeas.length ? (
          <div className="chips">
            <span className="chip-label">From your plan</span>
            {planIdeas.map((t) => <button key={t} type="button" className={`chip ${topic === t ? "on" : ""}`} onClick={() => setTopic(t)}>{t}</button>)}
          </div>
        ) : null}
        {!isOpen(d.topics_job) ? <button className="btn small ghost" type="button" style={{ justifySelf: "start" }} onClick={askChatGPT}>{claudeIdeas.length ? "Ask ChatGPT for new ideas" : "Ask ChatGPT for ideas"}</button> : null}
      </div>

      <div className="field"><span>Platforms</span>
        <div className="chips">{SLOT_PLATFORMS.map((p) => <button key={p} type="button" className={`chip ${platforms.includes(p) ? "on" : ""}`} onClick={() => setPlatforms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}>{p}</button>)}</div>
      </div>

      <details className="more">
        <summary>Posting {niceDate(date)} at {time} · change ›</summary>
        <div className="form-grid">
          <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Time</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
      </details>

      <div className="actions"><button className="btn primary big" type="button" disabled={busy || !topic.trim()} onClick={finalize}>{busy ? "Saving…" : "Save and start research"}</button></div>
    </section>
  );
}

/* ---------- 2 · Research (automatic) ---------- */
type Sig = { title: string; link: string; source: string; date: string; note?: string };
type Signals = { gathered_at: string; query: string; topic_news: Sig[]; competitor_news: Sig[]; reddit: Sig[]; trends: Sig[]; searches?: Sig[]; errors: string[] };
type Angle = { angle: string; message: string; why?: string };

function SignalList({ items, empty }: { items: Sig[]; empty: string }) {
  if (!items?.length) return <p className="small muted">{empty}</p>;
  return (
    <ul className="sig-list">
      {items.map((i) => (
        <li key={i.link}>
          <a href={i.link} target="_blank" rel="noreferrer">{i.title}</a>
          <span>{[i.source, i.date].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

function Evidence({ title, summary, items, empty }: { title: string; summary?: string; items: Sig[]; empty: string }) {
  return (
    <section className="panel evidence">
      <h4>{title}</h4>
      {summary ? <p className="summary">{summary}</p> : !items.length ? <p className="small muted">{empty}</p> : null}
      {items.length ? (
        <details className="more">
          <summary>{items.length} source{items.length === 1 ? "" : "s"} ›</summary>
          <SignalList items={items} empty={empty} />
        </details>
      ) : null}
    </section>
  );
}

function StageResearch({ d, patch, next, push }: { d: Detail; patch: (b: Record<string, unknown>) => Promise<void>; next: (format: string) => void; push: Push }) {
  const s = d.slot;
  const r = (s.research || {}) as Record<string, unknown>;
  const signals = r.signals as Signals | undefined;
  const angles = (r.angles as Angle[] | undefined) || [];
  const analysed = Boolean(r.analysed_at);
  const job = d.research_job;
  const [angle, setAngle] = useState((r.angle as string) || "");
  const [message, setMessage] = useState((r.message as string) || "");
  const [format, setFormat] = useState((r.angle ? s.format : (r.recommended_format as string)) || s.format);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    setStarting(true);
    try {
      await postJson(`/api/slots/${s.id}/research`, {});
      await patch({ stage: Math.max(s.stage, 2) });
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setStarting(false);
    }
  }, [s.id, s.stage, patch, push]);

  // nothing gathered yet and nothing running: start on arrival, once
  useEffect(() => {
    if (started.current) return;
    if (!signals && (!job || job.status === "failed" || job.status === "done")) {
      started.current = true;
      run();
    }
  }, [signals, job, run]);

  // adopt ChatGPT's first angle and recommended format when they arrive, unless already chosen
  useEffect(() => {
    if (analysed && !r.angle && angles[0] && !angle) { setAngle(angles[0].angle); setMessage(angles[0].message); }
    if (analysed && r.recommended_format && !r.angle) setFormat(r.recommended_format as string);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysed]);

  const waiting = isOpen(job);
  const finalize = async () => {
    if (!angle.trim()) return push("Pick an angle", "bad");
    setBusy(true);
    try {
      const changed = angle !== r.angle || message !== r.message;
      await patch({ research: { angle, message }, format });
      // ChatGPT starts on the captions now, so they're ready by the time the image is
      if (changed || !(r.copy_drafts && Object.keys(r.copy_drafts as object).length)) void postJson(`/api/slots/${s.id}/copy`, {}).catch(() => null);
      next(format);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>{analysed ? "Pick an angle" : "Researching this topic"}</h3>
          <button className="btn small ghost" type="button" disabled={starting || waiting} onClick={run}>Research again</button>
        </div>
        {starting && !signals ? <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>Searching this topic: news, what competitors said about it, Reddit, and what people type into Google and YouTube…</strong>This takes a few seconds.</div> : null}
        {waiting ? <ClaudeWaiting job={job} doing="writing the research and angle options" /> : null}
        {job?.status === "failed" ? <div className="note bad"><strong>The analysis didn&apos;t finish</strong>{job.error || "Press Research again."}</div> : null}

        {analysed && angles.length ? (
          <>
            <div className="angle-grid">
              {angles.map((a) => {
                const on = angle === a.angle;
                return (
                  <button key={a.angle} type="button" className={`angle ${on ? "on" : ""}`} onClick={() => { setAngle(a.angle); setMessage(a.message); }} aria-pressed={on}>
                    <strong>{a.angle}</strong>
                    <span className="angle-msg">&ldquo;{a.message}&rdquo;</span>
                    {a.why ? <span className="angle-why">{a.why}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="field"><span>Format {r.recommended_format ? <em>ChatGPT suggests {FORMAT_LABEL[r.recommended_format as string]}</em> : null}</span>
              <div className="chips">{Object.entries(FORMAT_LABEL).map(([k, v]) => <button key={k} type="button" className={`chip ${format === k ? "on" : ""}`} onClick={() => setFormat(k)}>{v}</button>)}</div>
            </div>
            <details className="more">
              <summary>Edit the angle or message ›</summary>
              <div className="stack" style={{ gap: 10 }}>
                <label className="field"><span>Angle</span><input className="input" value={angle} onChange={(e) => setAngle(e.target.value)} /></label>
                <label className="field"><span>Key message</span><input className="input" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
              </div>
            </details>
            <div className="actions">
              <button className="btn primary big" type="button" disabled={busy || !angle} onClick={finalize}>{busy ? "Saving…" : format === "text" ? "Use this angle and write captions" : "Use this angle"}</button>
              <span className="small muted">ChatGPT starts the captions as soon as you pick.</span>
            </div>
          </>
        ) : null}
      </section>

      {signals ? (
        <>
          <p className="small muted" style={{ margin: "4px 2px 0" }}>
            What the research found{signals.errors?.length ? `. Couldn't reach: ${signals.errors.map((e) => e.split(":")[0]).join(", ")}` : ""}
          </p>
          <div className="cols-2">
            <Evidence title="Competitors on this topic" summary={r.summary_competitor as string} items={signals.competitor_news} empty="Nothing from competitors on this topic." />
            <Evidence title="Market" summary={r.summary_market as string} items={signals.topic_news} empty="No recent news on this topic." />
            <Evidence title="What riders are saying" summary={r.summary_topic as string} items={signals.reddit} empty="No Reddit threads found for this topic." />
            <Evidence title="What people search for this" summary={r.summary_trends as string} items={signals.searches?.length ? signals.searches : signals.trends} empty="No search phrases came back for this topic." />
          </div>
        </>
      ) : null}

      {analysed && (r.sources as { title: string; url: string }[] | undefined)?.length ? (
        <details className="panel more">
          <summary>Sources ChatGPT used ›</summary>
          <ul className="sig-list">{(r.sources as { title: string; url: string }[]).map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.title || x.url}</a></li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

/* ---------- 3 · Samples ---------- */
const SOURCE_LINKS = (q: string) => [
  { label: "Pinterest", href: `https://www.pinterest.com/search/pins/?q=${q}` },
  { label: "Behance", href: `https://www.behance.net/search/projects?search=${q}` },
  { label: "Meta ads", href: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=${q}&search_type=keyword_unordered&media_type=all` },
  { label: "LinkedIn", href: `https://www.linkedin.com/search/results/content/?keywords=${q}` },
  { label: "X", href: `https://x.com/search?q=${q}&f=media` },
  { label: "Reddit", href: `https://www.reddit.com/search/?q=${q}` },
  { label: "Google Images", href: `https://www.google.com/search?tbm=isch&q=${q}` },
];
function StageSamples({ d, load, next, push }: { d: Detail; load: () => Promise<void>; next: () => void; push: Push }) {
  const s = d.slot;
  const [all, setAll] = useState<Insp[]>([]);
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState("Pinterest");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [refAt, setRefAt] = useState<{ list: ViewerItem[]; at: number } | null>(null);
  const chosen = useMemo(() => new Set(d.samples.map((x) => x.id)), [d.samples]);

  const loadAll = useCallback(() => api<Insp[]>("/api/inspirations").then((r) => setAll(r.filter((i) => i.file_id))).catch(() => null), []);
  useEffect(() => { loadAll(); }, [loadAll]);

  // rank saved inspiration by how many words it shares with the topic, angle and pillar
  const terms = useMemo(() => {
    const stop = new Set(["with", "your", "from", "that", "this", "what", "how", "the", "and", "for", "you", "are", "into", "about", "post", "explained"]);
    const rr = (s.research || {}) as Record<string, unknown>;
    // ChatGPT's keywords for this post first, then the words of the topic, angle and pillar
    const kw = ((rr.keywords as string[] | undefined) || []).flatMap((k) => [k.toLowerCase(), ...k.toLowerCase().split(/[^a-z0-9]+/)]);
    const words = `${s.topic} ${rr.angle || ""} ${s.pillar_name || ""} ${FORMAT_LABEL[s.format] || ""}`.toLowerCase().split(/[^a-z0-9]+/);
    return Array.from(new Set([...kw, ...words].filter((w) => w.length > 3 && !stop.has(w))));
  }, [s.topic, s.research, s.pillar_name, s.format]);
  const score = (i: Insp) => { const hay = `${i.title} ${i.competitor} ${i.platform} ${i.notes} ${(i as Insp & { format?: string }).format || ""}`.toLowerCase(); return terms.filter((w) => hay.includes(w)).length; };
  const shown = all
    .filter((i) => !q || `${i.title} ${i.competitor} ${i.platform} ${i.notes}`.toLowerCase().includes(q.toLowerCase()))
    .map((i) => ({ i, sc: score(i) }))
    .sort((a, b) => b.sc - a.sc)
    .map(({ i, sc }) => Object.assign(i, { _match: sc > 0 }));
  const [making, setMaking] = useState<string | null>(null);
  // one reference, our product swapped in: queue a single draft from just this image
  const makeOurs = async (i: Insp) => {
    if (making) return;
    setMaking(i.id);
    try {
      await postJson(`/api/slots/${s.id}/iterate`, { count: 1, inspiration_ids: [i.id] });
      push("Creating a version with your product. It appears in Drafts in a few minutes.", "ok");
      await load();
      next();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setMaking(null);
    }
  };
  const toggle = async (i: Insp) => {
    if (chosen.has(i.id)) await api(`/api/slots/${s.id}/samples?inspiration_id=${i.id}`, { method: "DELETE" });
    else await postJson(`/api/slots/${s.id}/samples`, { inspiration_ids: [i.id] });
    load();
  };
  const upload = async () => {
    if (!files.length) return push("Choose images first", "bad");
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      fd.append("platform", source);
      fd.append("title", s.topic ? `${s.topic} sample` : "Sample");
      fd.append("rights", "Third-party. Reference only, do not publish.");
      const created = await api<Insp[]>("/api/inspirations", { method: "POST", body: fd });
      await postJson(`/api/slots/${s.id}/samples`, { inspiration_ids: created.map((c) => c.id) });
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      push(`Added ${created.length} sample${created.length > 1 ? "s" : ""}`, "ok");
      loadAll();
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const topicQ = encodeURIComponent(s.topic || "electric motorcycle ad");
  const asItem = (i: Insp): ViewerItem => ({
    id: i.id,
    src: fileUrl(i.file_id as string),
    title: i.title || "Reference",
    subtitle: [i.platform, i.competitor].filter(Boolean).join(" · "),
    body: i.notes || "",
    links: i.source_url ? [{ label: "Where it came from", url: i.source_url }] : [],
  });
  const pickedItems = d.samples.map(asItem);
  const shownItems = shown.filter((i) => i.file_id).map(asItem);

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head"><h3>References for this post</h3><Pill tone={d.samples.length ? "ok" : "warn"}>{d.samples.length} picked</Pill></div>
        {d.samples.length ? (
          <div className="src-grid">
            {d.samples.map((i) => (
              <div key={i.id} className="src-card on ref-card">
                <div className="pic" onClick={() => toggle(i)} title="Click to remove"><img src={fileUrl(i.file_id)} alt={i.title} /></div>
                <span className="tick">✓</span>
                <div className="ref-foot">
                  <span className="small" title={i.title}>{i.title}</span>
                  <span className="actions">
                    <button className="btn small" type="button" onClick={() => setRefAt({ list: pickedItems, at: pickedItems.findIndex((x) => x.id === i.id) })}>View</button>
                    <button className="btn small primary" type="button" disabled={making === i.id} onClick={() => makeOurs(i)}>{making === i.id ? "Starting…" : "Make it ours"}</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty title="No references picked yet" hint="Tap images below. The best matches for this topic come first." />}
        <div className="actions">
          <button className="btn primary big" type="button" disabled={!d.samples.length} onClick={next}>Continue to first draft</button>
          {!d.samples.length ? <button className="btn big" type="button" onClick={next}>Create without references</button> : null}
        </div>
        {!d.samples.length ? <p className="small muted" style={{ margin: 0 }}>References copy a layout you like. Without them, ChatGPT invents the picture from your topic, angle and product photo.</p> : null}
      </section>

      <section className="panel stack">
        <div className="panel-head"><h3>Pick from your saved inspiration</h3><Link className="btn small ghost" href="/inspiration" target="_blank">Open library ↗</Link></div>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved inspiration" />
        {shown.length ? (
          <div className="src-grid">
            {shown.map((i) => (
              <div key={i.id} className={`src-card ${chosen.has(i.id) ? "on" : ""}`} onClick={() => toggle(i)}>
                <div className="pic"><img src={fileUrl(i.file_id)} alt={i.title} loading="lazy" /></div>
                <span className="tick">{chosen.has(i.id) ? "✓" : ""}</span>
                {(i as Insp & { _match?: boolean })._match ? <span className="match-tag">Matches topic</span> : null}
                <div className="meta"><strong>{i.title}</strong><span>{[i.platform, i.competitor].filter(Boolean).join(" · ") || "Saved"}</span>
                  <span className="meta-links"><button type="button" onClick={(e) => { e.stopPropagation(); setRefAt({ list: shownItems, at: shownItems.findIndex((x) => x.id === i.id) }); }}>View</button></span>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty title="Nothing matches" hint="Try another word, or upload new references below." />}
      </section>
      <FreeImageSearch slot={s} terms={terms} onAdded={() => { loadAll(); load(); }} push={push} />

      <details className="panel more add-refs">
        <summary>Find or upload new references ›</summary>
        <div className="stack">
        <p className="small muted">Opens a search for &ldquo;{s.topic}&rdquo;. Save or screenshot what you like, then upload it below.</p>
        <div className="chips">{SOURCE_LINKS(topicQ).map((x) => <a key={x.label} className="chip" href={x.href} target="_blank" rel="noreferrer">{x.label} ↗</a>)}</div>
        <div className="form-grid">
          <label className="field full">
            <span>Upload samples</span>
            <label className={`file-drop ${files.length ? "active" : ""}`}>
              <input ref={fileInput} type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              {files.length ? `${files.length} selected` : "Choose screenshots or saved images"}
            </label>
          </label>
          <label className="field"><span>Where they&apos;re from</span>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              {["Pinterest", "Behance", "Ads", "LinkedIn", "X", "Reddit", "Instagram", "Website"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <div className="field" style={{ alignSelf: "end" }}><button className="btn" type="button" disabled={busy || !files.length} onClick={upload}>{busy ? "Uploading…" : "Upload and add"}</button></div>
        </div>
        </div>
      </details>
      {refAt ? <ImageViewer items={refAt.list} index={refAt.at} onIndex={(i) => setRefAt((v) => (v ? { ...v, at: i } : v))} onClose={() => setRefAt(null)} eyebrow="Reference" /> : null}
    </div>
  );
}

/* ---------- shared: draft grid ---------- */
function DraftGrid({ drafts, pickedId, onPick, actionLabel }: { drafts: Draft[]; pickedId?: string | null; onPick: (dr: Draft) => void; actionLabel: string }) {
  const [at, setAt] = useState<number | null>(null);
  const items: ViewerItem[] = drafts.map((dr, i) => ({
    id: dr.id,
    src: fileUrl(dr.file_id),
    title: `Option ${i + 1}`,
    subtitle: fmtDate(dr.created_at),
    tags: [{ label: `Round ${dr.round}` }, ...(pickedId === dr.id ? [{ label: "Picked", tone: "ok" }] : [])],
    fields: dr.model ? [{ label: "Made with", value: dr.model }] : [],
  }));
  return (
    <div className="draft-grid">
      {drafts.map((dr, i) => (
        <div key={dr.id} className={`draft ${pickedId === dr.id ? "on" : ""}`}>
          <button type="button" className="draft-img" title="Open it here" onClick={() => setAt(i)}><img src={fileUrl(dr.file_id)} alt={`Draft ${i + 1}`} /></button>
          <div className="draft-foot">
            <span className="small muted">Option {i + 1}</span>
            <span className="actions">
              <button className="btn small" type="button" onClick={() => setAt(i)}>View</button>
              <button className={`btn small ${pickedId === dr.id ? "primary" : ""}`} type="button" onClick={() => onPick(dr)}>{pickedId === dr.id ? "Picked" : actionLabel}</button>
            </span>
          </div>
        </div>
      ))}
      {at !== null ? <ImageViewer items={items} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Draft" /> : null}
    </div>
  );
}
/* Two ways to make an image: ChatGPT on the owner's ChatGPT plan, or Higgsfield on credits. */
function ProviderPicker({ value, onChange }: { value: "chatgpt" | "higgsfield"; onChange: (v: "chatgpt" | "higgsfield") => void }) {
  return (
    <div className="provider-pick">
      <button type="button" className={value === "chatgpt" ? "on" : ""} onClick={() => onChange("chatgpt")} aria-pressed={value === "chatgpt"}>
        <strong>ChatGPT</strong><span>Your ChatGPT plan. Runs inside Circuit.</span>
      </button>
      <button type="button" className={value === "higgsfield" ? "on" : ""} onClick={() => onChange("higgsfield")} aria-pressed={value === "higgsfield"}>
        <strong>Higgsfield</strong><span>Credits. Choice of styles. Needs the Claude session.</span>
      </button>
    </div>
  );
}

function PendingNote({ jobs, round }: { jobs: Job[]; round: number }) {
  const open = jobs.filter((j) => j.round === round && (j.status === "queued" || j.status === "running"));
  const failed = jobs.filter((j) => j.round === round && j.status === "failed");
  if (!open.length && !failed.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {open.length ? <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>Creating {open.length} draft{open.length > 1 ? "s" : ""} with {open.every((j) => j.model === "chatgpt_image") ? "ChatGPT" : open.some((j) => j.model === "chatgpt_image") ? "ChatGPT and Higgsfield" : "Higgsfield"}…</strong>They appear here as each one finishes. You can leave this page.</div> : null}
      {failed.length ? <div className="note bad"><strong>{failed.length} draft{failed.length > 1 ? "s" : ""} didn&apos;t work</strong>{failed[0].error?.slice(0, 160)}</div> : null}
    </div>
  );
}

/* ---------- 4 · First draft ---------- */
function StageDraft({ d, load, next, push }: { d: Detail; load: () => Promise<void>; next: () => void; push: Push }) {
  const s = d.slot;
  const [products, setProducts] = useState<Product[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [productId, setProductId] = useState(s.product_id || "");
  const [provider, setProvider] = useState<"chatgpt" | "higgsfield">(s.model && s.model !== "chatgpt_image" ? "higgsfield" : "chatgpt");
  const [model, setModel] = useState(s.model && s.model !== "chatgpt_image" ? s.model : "gpt_image_2_5");
  const [count, setCount] = useState(s.iterations || 3);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Product[]>("/api/products").then((p) => { setProducts(p); setProductId((x) => x || p[0]?.id || ""); }).catch(() => null);
    api<Model[]>("/api/render?models=1").then(setModels).catch(() => null);
  }, []);
  const round1 = d.drafts.filter((x) => x.round === 1);

  const creating = useRef(false);
  const create = async () => {
    if (!productId) return push("Pick a bike photo", "bad");
    // a fast double click must not queue (and pay for) the same drafts twice
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      const r = await postJson<{ queued: number }>(`/api/slots/${s.id}/iterate`, { count, notes, model, product_id: productId, provider });
      push(`Creating ${r.queued} draft${r.queued > 1 ? "s" : ""}`, "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
      creating.current = false;
    }
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head"><h3>Create the first drafts</h3></div>
        <div className="field"><span>Bike photo</span>
          <div className="thumb-strip">
            {products.map((p) => (
              <button key={p.id} type="button" className={p.id === productId ? "selected" : ""} onClick={() => setProductId(p.id)} title={`${p.name} ${p.color}`} aria-pressed={p.id === productId}>
                <img src={fileUrl(p.file_id)} alt={`${p.name} ${p.color}`} />
              </button>
            ))}
            {!products.length ? <span className="small muted">No product photos yet. Drop them into the product folder (Settings, Product photos) or upload them in the Library.</span> : null}
          </div>
        </div>
        <div className="field"><span>Create with</span>
          <ProviderPicker value={provider} onChange={setProvider} />
        </div>
        <div className="form-grid">
          {provider === "higgsfield" ? (
            <label className="field"><span>Style</span>
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </label>
          ) : null}
          <label className="field"><span>How many options <em>iterations</em></span>
            <select className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <label className="field full"><span>{d.samples.length ? "Anything to change?" : "What should the picture show?"} <em>optional</em></span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={d.samples.length ? "For example: leave space at the top for a headline" : "For example: a delivery rider loading crates at a Coimbatore market at sunrise"} /></label>
        </div>
        <p className="small muted">{d.samples.length ? `Uses ${d.samples.length} reference${d.samples.length === 1 ? "" : "s"} from step 3, spread across the options.` : "No references picked, so the picture is invented from your topic, angle and product photo. Add a reference in step 3 to copy a layout instead."} {provider === "chatgpt" ? "Uses your ChatGPT plan; each option takes about a minute and a half, one after another." : "Each option costs 1 to 2 Higgsfield credits and renders through the Claude session."}</p>
        <div className="actions"><button className="btn primary big" type="button" disabled={busy} onClick={create}>{busy ? "Starting…" : `Create ${count} option${count > 1 ? "s" : ""}`}</button></div>
      </section>

      <section className="panel stack">
        <div className="panel-head"><h3>Draft 1</h3>{round1.length ? <Pill tone="ok">{round1.length} ready</Pill> : null}</div>
        <PendingNote jobs={d.jobs} round={1} />
        {round1.length ? <DraftGrid drafts={round1} onPick={() => next()} actionLabel="Refine" /> : !d.jobs.some((j) => j.round === 1) ? <Empty title="No drafts yet" hint="Press Create above." /> : null}
        {round1.length ? <div className="actions"><button className="btn primary" type="button" onClick={next}>Pick the closest one</button></div> : null}
      </section>

      {round1.length ? <PosterCopy d={d} load={load} push={push} /> : null}
    </div>
  );
}

/* ---------- 5 · Refine ---------- */
function StageRefine({ d, load, patch, next, push }: { d: Detail; load: () => Promise<void>; patch: (b: Record<string, unknown>) => Promise<void>; next: () => void; push: Push }) {
  const s = d.slot;
  const rounds = Array.from(new Set(d.drafts.map((x) => x.round))).sort((a, b) => b - a);
  const latest = rounds[0] || 1;
  const [parent, setParent] = useState<Draft | null>(null);
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(Math.min(s.iterations || 3, 3));
  const [busy, setBusy] = useState(false);

  const [refineWith, setRefineWith] = useState<"chatgpt" | "higgsfield">(s.model && s.model !== "chatgpt_image" ? "higgsfield" : "chatgpt");
  const refine = async () => {
    if (!parent) return push("Pick the closest option first", "bad");
    if (!notes.trim()) return push("Say what should change", "bad");
    setBusy(true);
    try {
      const r = await postJson<{ queued: number; round: number }>(`/api/slots/${s.id}/iterate`, { parent_id: parent.id, notes, count, provider: refineWith });
      push(`Creating draft ${r.round}`, "ok");
      setNotes("");
      setParent(null);
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const approve = async (dr: Draft) => {
    await patch({ final_creation_id: dr.id });
    next();
  };

  if (!d.drafts.length) return <section className="panel"><PendingNote jobs={d.jobs} round={1} /><Empty title="No drafts to refine yet" hint="Create the first drafts in stage 4." /></section>;

  return (
    <div className="stack">
      {parent ? (
        <section className="panel stack">
          <div className="panel-head"><h3>Refine this option into draft {parent.round + 1}</h3><button className="btn small ghost" type="button" onClick={() => setParent(null)}>Pick another</button></div>
          <div className="refine-row">
            <ViewableImage item={{ id: parent.id, src: fileUrl(parent.file_id), title: `Draft round ${parent.round}`, subtitle: fmtDate(parent.created_at) }} eyebrow="Picked draft" alt="Picked draft" />
            <div className="stack" style={{ gap: 12 }}>
              <label className="field"><span>What should change?</span><textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For example: make the bike olive green, add rain on the road, more space at the top" /></label>
              <div className="field"><span>Create with</span><ProviderPicker value={refineWith} onChange={setRefineWith} /></div>
              <label className="field"><span>How many options</span>
                <select className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
              </label>
              <div className="actions">
                <button className="btn primary" type="button" disabled={busy} onClick={refine}>{busy ? "Starting…" : "Create next draft"}</button>
                <button className="btn" type="button" onClick={() => approve(parent)}>This one is final</button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {rounds.map((round) => (
        <section key={round} className="panel stack">
          <div className="panel-head"><h3>Draft {round}</h3>{round === latest ? <Pill tone="ok">Latest</Pill> : null}</div>
          <PendingNote jobs={d.jobs} round={round} />
          <DraftGrid drafts={d.drafts.filter((x) => x.round === round)} pickedId={parent?.id} onPick={(dr) => { setParent(dr); window.scrollTo({ top: 0, behavior: "smooth" }); }} actionLabel="Closest" />
        </section>
      ))}
      {d.jobs.some((j) => j.round > latest && (j.status === "queued" || j.status === "running")) ? <section className="panel"><PendingNote jobs={d.jobs} round={latest + 1} /></section> : null}
    </div>
  );
}

/* ---------- 6 · Approve ---------- */
function StageApprove({ d, patch, next, back, push }: { d: Detail; patch: (b: Record<string, unknown>) => Promise<void>; next: () => void; back: () => void; push: Push }) {
  const [busy, setBusy] = useState(false);
  const final = d.final;
  const approve = async () => {
    if (!final) return;
    setBusy(true);
    try {
      await postJson("/api/creations", { id: final.id, status: "approved" }, "PATCH");
      await patch({ status: "approved" });
      push("Approved", "ok");
      next();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  if (!final) return <section className="panel stack"><Empty title="No final draft picked" hint="Go back to Refine and press This one is final on the draft you want." /><div className="actions"><button className="btn primary" type="button" onClick={back}>Back to Refine</button></div></section>;
  return (
    <section className="panel stack">
      <div className="panel-head"><h3>Approve the final image</h3><Pill tone={final.status === "approved" ? "ok" : "warn"}>{final.status}</Pill></div>
      <div className="approve-row">
        <ViewableImage item={{ id: final.id, src: fileUrl(final.file_id), title: "Final image", subtitle: fmtDate(final.created_at), tags: [{ label: final.status, tone: final.status === "approved" ? "ok" : "warn" }] }} eyebrow="Final image" alt="Final draft" />
        <div className="stack" style={{ gap: 12 }}>
          <p>This exact image is what gets posted. Check the bike, the colours and that there&apos;s no stray text or logo.</p>
          <ul className="checklist">
            <li>The bike looks like the real Challenger</li>
            <li>The colour matches</li>
            <li>No competitor logo or text is left</li>
            <li>There&apos;s room for the headline if the platform needs it</li>
          </ul>
          <div className="actions">
            <button className="btn primary big" type="button" disabled={busy} onClick={approve}>{busy ? "Approving…" : "Approve"}</button>
            <button className="btn ghost" type="button" onClick={back}>Keep refining</button>
          </div>
        </div>
      </div>
    </section>
  );
}


/* ---------- Carousel slides ---------- */
type Slide = { id: string; position: number; headline: string; body: string; image_idea: string; file_id: string | null; bg_file_id: string | null };

/* Draws one slide at Instagram's 1080×1350 straight in the browser: the picture if there is one,
   a brand-coloured ground if not, then the headline and body on top. No credits, crisp text. */
async function designSlide(slide: Slide, index: number, total: number, brandName: string) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw slides");
  const src = slide.bg_file_id || slide.file_id;
  ctx.fillStyle = "#0A4938";
  ctx.fillRect(0, 0, W, H);
  if (src) {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read the slide image"));
      i.src = fileUrl(src);
    });
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    const grad = ctx.createLinearGradient(0, H * 0.35, 0, H);
    grad.addColorStop(0, "rgba(6,20,16,0)");
    grad.addColorStop(1, "rgba(6,20,16,0.82)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  const pad = 72;
  const wrap = (text: string, font: string, maxWidth: number) => {
    ctx.font = font;
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const headFont = "600 74px 'Space Grotesk', system-ui, sans-serif";
  const bodyFont = "400 36px 'Space Grotesk', system-ui, sans-serif";
  const headLines = slide.headline ? wrap(slide.headline, headFont, W - pad * 2) : [];
  const bodyLines = slide.body ? wrap(slide.body, bodyFont, W - pad * 2) : [];
  let y = H - pad - (bodyLines.length ? bodyLines.length * 48 + 28 : 0) - headLines.length * 84;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = headFont;
  ctx.textBaseline = "alphabetic";
  for (const l of headLines) { ctx.fillText(l, pad, y); y += 84; }
  if (bodyLines.length) {
    y += 16;
    ctx.font = bodyFont;
    ctx.fillStyle = "rgba(255,255,255,.88)";
    for (const l of bodyLines) { ctx.fillText(l, pad, y); y += 48; }
  }
  ctx.font = "500 26px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.fillText(brandName, pad, pad + 20);
  const label = `${index + 1}/${total}`;
  ctx.fillText(label, W - pad - ctx.measureText(label).width, pad + 20);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't save the slide");
  return blob;
}

function SlidesPanel({ d, load, push }: { d: Detail; load: () => Promise<void>; push: Push }) {
  const s = d.slot;
  const slides = d.slides;
  const [brand, setBrand] = useState("BNC Motors");
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api<{ brand: { name: string } }>("/api/settings").then((r) => setBrand(r.brand.name)).catch(() => null); }, []);
  const planning = d.slides_job?.status === "queued" || d.slides_job?.status === "running";
  const rendering = d.jobs.some((j) => j.slide_id && (j.status === "queued" || j.status === "running"));
  useEffect(() => { if (at > Math.max(slides.length - 1, 0)) setAt(0); }, [slides.length, at]);

  const plan = async () => {
    setBusy("plan");
    try {
      await postJson(`/api/slots/${s.id}/slides`, { action: "plan" });
      push("ChatGPT is planning the slides", "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const add = async () => {
    await postJson(`/api/slots/${s.id}/slides`, { slides: [{ headline: "New slide", body: "", image_idea: "" }] });
    load();
  };
  const patch = async (id: string, body: Record<string, unknown>) => { await postJson(`/api/slots/${s.id}/slides`, { id, ...body }, "PATCH"); load(); };
  const move = async (i: number, dir: -1 | 1) => {
    const order = slides.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await postJson(`/api/slots/${s.id}/slides`, { order }, "PATCH");
    setAt(j);
    load();
  };
  const remove = async (sl: Slide) => {
    if (!confirm("Remove this slide?")) return;
    await api(`/api/slots/${s.id}/slides?slide_id=${sl.id}`, { method: "DELETE" });
    load();
  };
  const design = async (sl: Slide, i: number) => {
    setBusy(sl.id);
    try {
      const blob = await designSlide(sl, i, slides.length, brand);
      const fd = new FormData();
      fd.append("slide_id", sl.id);
      fd.append("file", blob, `slide-${i + 1}.png`);
      await api(`/api/slots/${s.id}/slides`, { method: "POST", body: fd });
      push(`Slide ${i + 1} designed`, "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const picture = async (sl: Slide, provider: "chatgpt" | "higgsfield") => {
    setBusy(sl.id);
    try {
      await postJson(`/api/slots/${s.id}/slides`, { action: "image", slide_id: sl.id, provider });
      push(provider === "chatgpt" ? "ChatGPT is drawing this slide" : "Queued for Higgsfield", "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  const cur = slides[at];
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Carousel slides</h3>
        <span className="actions">
          {slides.length ? <Pill tone={slides.every((x) => x.file_id) ? "ok" : "warn"}>{slides.filter((x) => x.file_id).length} of {slides.length} ready</Pill> : null}
          <button className="btn small" type="button" disabled={Boolean(busy) || planning} onClick={plan}>{planning ? "Planning…" : slides.length ? "Plan again" : "Plan with ChatGPT"}</button>
          <button className="btn small ghost" type="button" onClick={add}>Add slide</button>
        </span>
      </div>
      {planning ? <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>ChatGPT is planning the slides</strong>A hook, the middle slides and a call to action. About a minute.</div> : null}
      {!slides.length && !planning ? <Empty title="No slides yet" hint="Plan them with ChatGPT from your angle, or add them by hand." /> : null}

      {slides.length ? (
        <div className="carousel">
          <button className="car-arrow" type="button" aria-label="Previous slide" disabled={at === 0} onClick={() => setAt((n) => Math.max(0, n - 1))}>‹</button>
          <div className="car-stage">
            {cur?.file_id ? <ViewableImage
                item={{ id: cur.id, src: fileUrl(cur.file_id), title: cur.headline || `Slide ${at + 1}`, subtitle: `Slide ${at + 1} of ${slides.length}`, body: cur.body || "" }}
                items={slides.filter((x) => x.file_id).map((x, n) => ({ id: x.id, src: fileUrl(x.file_id as string), title: x.headline || `Slide ${n + 1}`, body: x.body || "" }))}
                eyebrow="Carousel" alt={`Slide ${at + 1}`} />
              : <div className="car-placeholder"><strong>{cur?.headline || `Slide ${at + 1}`}</strong>{cur?.body ? <span>{cur.body}</span> : null}<small>No picture yet</small></div>}
          </div>
          <button className="car-arrow" type="button" aria-label="Next slide" disabled={at >= slides.length - 1} onClick={() => setAt((n) => Math.min(slides.length - 1, n + 1))}>›</button>
          <div className="car-dots">{slides.map((x, i) => <button key={x.id} type="button" className={i === at ? "on" : ""} aria-label={`Slide ${i + 1}`} onClick={() => setAt(i)} />)}</div>
        </div>
      ) : null}
      {rendering ? <p className="small muted" style={{ margin: 0 }}>A slide picture is being created. It appears here when it&apos;s done.</p> : null}

      <div className="slide-rows">
        {slides.map((sl, i) => (
          <div key={sl.id} className={`slide-row ${i === at ? "on" : ""}`}>
            <button type="button" className="slide-thumb" onClick={() => setAt(i)} aria-label={`Show slide ${i + 1}`}>
              {sl.file_id ? <img src={fileUrl(sl.file_id)} alt="" /> : <span>{i + 1}</span>}
            </button>
            <div className="slide-main">
              <input className="input" value={sl.headline} onChange={(e) => patch(sl.id, { headline: e.target.value })} placeholder={`Slide ${i + 1} headline`} />
              <textarea className="textarea" rows={2} value={sl.body} onChange={(e) => patch(sl.id, { body: e.target.value })} placeholder="Body, or leave empty" />
              {open === sl.id ? <input className="input" value={sl.image_idea} onChange={(e) => patch(sl.id, { image_idea: e.target.value })} placeholder="What the picture shows" /> : null}
              <div className="actions">
                <button className="btn small primary" type="button" disabled={busy === sl.id} onClick={() => design(sl, i)}>{busy === sl.id ? "Working…" : sl.file_id ? "Redesign text" : "Design it here"}</button>
                <button className="btn small" type="button" disabled={busy === sl.id} onClick={() => picture(sl, "chatgpt")}>Picture with ChatGPT</button>
                <button className="btn small ghost" type="button" disabled={busy === sl.id} onClick={() => picture(sl, "higgsfield")}>Higgsfield</button>
                <button className="btn small ghost" type="button" onClick={() => setOpen(open === sl.id ? null : sl.id)}>{open === sl.id ? "Hide" : "Picture idea"}</button>
                <button className="btn small ghost" type="button" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn small ghost" type="button" onClick={() => move(i, 1)} disabled={i === slides.length - 1}>↓</button>
                <button className="btn small ghost" type="button" onClick={() => remove(sl)}>Remove</button>
                {sl.file_id ? <a className="btn small ghost" href={fileUrl(sl.file_id)} download={`slide-${i + 1}.png`}>Download</a> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      {slides.length ? <p className="small muted" style={{ margin: 0 }}>Design it here puts your headline on the slide in brand colours, free. Picture with ChatGPT or Higgsfield draws the image behind it; design the text on top afterwards.</p> : null}
    </section>
  );
}

/* ---------- 7 · Captions ---------- */
type CopyDraft = { caption: string; hashtags: string; title: string; label?: string };
// ChatGPT sends several options per platform; older posts hold a single one
const optionsOf = (v: CopyDraft | CopyDraft[] | undefined): CopyDraft[] => (Array.isArray(v) ? v : v ? [v] : []);
function StageContent({ d, load, next, push }: { d: Detail; load: () => Promise<void>; next: () => void; push: Push }) {
  const s = d.slot;
  const r = (s.research || {}) as Record<string, unknown>;
  const drafts = (r.copy_drafts as Record<string, CopyDraft | CopyDraft[]> | undefined) || {};
  const hasDrafts = Object.keys(drafts).length > 0;
  const [brand, setBrand] = useState<Brand | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const savers = useRef<Record<string, () => Promise<boolean>>>({});
  const asked = useRef(false);
  useEffect(() => { api<{ brand: Brand }>("/api/settings").then((res) => setBrand(res.brand)).catch(() => null); }, []);

  const ask = useCallback(async (quiet = false) => {
    try {
      await postJson(`/api/slots/${s.id}/copy`, {});
      if (!quiet) push("Asked ChatGPT to write the captions", "ok");
      load();
    } catch (e) {
      if (!quiet) push((e as Error).message, "bad");
    }
  }, [s.id, load, push]);
  // nothing written and nothing queued: ask ChatGPT on arrival, once
  useEffect(() => {
    if (asked.current || hasDrafts || d.content.length || isOpen(d.copy_job) || !r.angle) return;
    asked.current = true;
    ask(true);
  }, [hasDrafts, d.content.length, d.copy_job, r.angle, ask]);

  const saved = new Set(d.content.map((c) => c.platform));
  const allSaved = s.platforms.length > 0 && s.platforms.every((p) => saved.has(p));
  const saveAll = async () => {
    setSavingAll(true);
    try {
      let ok = true;
      for (const p of s.platforms) ok = (await savers.current[p]?.()) !== false && ok;
      await load();
      if (ok) next();
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel stack" style={{ gap: 10 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>Captions</h3>
          {!isOpen(d.copy_job) && r.angle ? <button className="btn small ghost" type="button" onClick={() => ask()}>{hasDrafts ? "Ask ChatGPT to rewrite" : "Ask ChatGPT to write them"}</button> : null}
        </div>
        {isOpen(d.copy_job) ? <ClaudeWaiting job={d.copy_job} doing="writing the captions" /> : hasDrafts ? (
          <p className="small muted" style={{ margin: 0 }}>ChatGPT wrote a few options for each platform. Pick one, check anything marked [check spec sheet], edit what you like, then save.</p>
        ) : d.copy_job?.status === "failed" ? <div className="note bad"><strong>ChatGPT couldn&apos;t write the captions</strong>{d.copy_job.error}</div> : null}
      </section>
      {s.format === "carousel" ? <SlidesPanel d={d} load={load} push={push} /> : null}
      {s.platforms.map((p) => <PlatformEditor key={p} platform={p} d={d} brand={brand} existing={d.content.find((c) => c.platform === p)} options={optionsOf(drafts[p])} register={(fn) => { savers.current[p] = fn; }} push={push} />)}
      {!s.platforms.length ? <section className="panel"><Empty title="No platforms picked" hint="Choose platforms in step 1." /></section> : null}
      {s.platforms.length ? (
        <div className="actions">
          <button className="btn primary big" type="button" disabled={savingAll} onClick={saveAll}>{savingAll ? "Saving…" : allSaved ? "Save and continue to schedule" : `Save ${s.platforms.length > 1 ? "all captions" : "caption"} and continue`}</button>
        </div>
      ) : null}
    </div>
  );
}

const LIMITS: Record<string, number> = { Instagram: 2200, Facebook: 63206, LinkedIn: 3000, X: 280, Blog: 100000 };
function PlatformEditor({ platform, d, brand, existing, options, register, push }: { platform: string; d: Detail; brand: Brand | null; existing?: Content; options: CopyDraft[]; register: (fn: () => Promise<boolean>) => void; push: Push }) {
  const draft = options[0];
  const [pick, setPick] = useState(0);
  const s = d.slot;
  let meta0: Record<string, string> = {};
  try { meta0 = JSON.parse(existing?.meta || "{}"); } catch { meta0 = {}; }
  const [caption, setCaption] = useState(existing?.caption || draft?.caption || "");
  const [hashtags, setHashtags] = useState(existing ? meta0.hashtags || "" : draft?.hashtags || "");
  const [title, setTitle] = useState(existing ? meta0.title || "" : draft?.title || "");
  const [link, setLink] = useState(meta0.link || "");
  const touched = useRef(false);
  const isBlog = platform === "Blog";
  const limit = LIMITS[platform] || 2200;
  const img = d.final ? fileUrl(d.final.file_id) : "";

  // ChatGPT's options can arrive while the page is open: fill in, unless something was typed
  useEffect(() => {
    if (!draft || existing || touched.current) return;
    setCaption(draft.caption); setHashtags(draft.hashtags); setTitle(draft.title);
  }, [draft, existing]);
  const use = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (caption.trim() && caption !== options[pick]?.caption && !confirm("Replace what's in the box with this option?")) return;
    setPick(i);
    touched.current = true;
    setCaption(o.caption); setHashtags(o.hashtags); setTitle(o.title);
  };

  const save = useCallback(async () => {
    if (!caption.trim()) { push(`Write the ${platform} caption first`, "bad"); return false; }
    if (caption.length > limit) { push(`${platform} is too long by ${caption.length - limit} characters`, "bad"); return false; }
    try {
      await postJson(`/api/slots/${s.id}/content`, { platform, caption, meta: { hashtags, title, link } });
      return true;
    } catch (e) {
      push((e as Error).message, "bad");
      return false;
    }
  }, [caption, hashtags, title, link, platform, limit, s.id, push]);
  useEffect(() => { register(save); }, [register, save]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => { touched.current = true; set(v); };
  const dirty = existing ? caption !== existing.caption || hashtags !== (meta0.hashtags || "") : Boolean(caption);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{platform}</h3>
        <span className="actions">{existing && !dirty ? <Pill tone="ok">Saved</Pill> : draft && !existing ? <Pill>ChatGPT&apos;s draft</Pill> : dirty ? <Pill tone="warn">Not saved</Pill> : null}</span>
      </div>
      <div className="editor-row">
        <div className="stack" style={{ gap: 12 }}>
          {options.length > 1 ? (
            <div className="field"><span>ChatGPT&apos;s options <em>click one to use it</em></span>
              <div className="chips">
                {options.map((o, i) => (
                  <button key={i} type="button" className={`chip ${caption === o.caption ? "on" : ""}`} onClick={() => use(i)} title={o.caption.slice(0, 200)}>
                    {o.label || `Option ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {isBlog ? <label className="field"><span>Title</span><input className="input" value={title} onChange={(e) => edit(setTitle)(e.target.value)} /></label> : null}
          <label className="field"><span>{isBlog ? "Article" : "Caption"} <em>{caption.length}{limit < 10000 ? ` / ${limit}` : ""}</em></span>
            <textarea className="textarea" rows={isBlog ? 12 : 7} value={caption} onChange={(e) => edit(setCaption)(e.target.value)} placeholder={`ChatGPT's ${platform} draft appears here, or write your own`} />
          </label>
          {!isBlog ? <label className="field"><span>Hashtags</span><input className="input" value={hashtags} onChange={(e) => edit(setHashtags)(e.target.value)} placeholder="#electricbike #BNCMotors" /></label> : null}
          {platform === "LinkedIn" || platform === "Facebook" ? <label className="field"><span>Link <em>optional</em></span><input className="input" value={link} onChange={(e) => edit(setLink)(e.target.value)} placeholder="https://bncmotors.in/…" /></label> : null}
          {caption.length > limit ? <div className="note bad">Too long for {platform} by {caption.length - limit} characters.</div> : null}
        </div>
        <Preview platform={platform} img={img} caption={caption} hashtags={hashtags} title={title} brand={brand?.name || "BNC Motors"} hasImage={s.format !== "text"} />
      </div>
    </section>
  );
}

function Preview({ platform, img, caption, hashtags, title, brand, hasImage = true }: { platform: string; img: string; caption: string; hashtags: string; title: string; brand: string; hasImage?: boolean }) {
  const handle = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = caption || "Your copy appears here.";
  if (platform === "Blog") {
    return (
      <div className="preview blog">
        <div className="pv-label">Preview</div>
        {img ? <img src={img} alt="" /> : null}
        <h4>{title || "Article title"}</h4>
        <p>{text.slice(0, 420)}{text.length > 420 ? "…" : ""}</p>
      </div>
    );
  }
  const isX = platform === "X";
  return (
    <div className={`preview ${platform.toLowerCase()}`}>
      <div className="pv-label">Preview</div>
      <div className="pv-head"><span className="pv-avatar">{brand.slice(0, 1)}</span><div><strong>{platform === "LinkedIn" ? brand : handle}</strong><small>{platform === "LinkedIn" ? "Promoted · 1st" : isX ? `@${handle}` : "Sponsored"}</small></div></div>
      {platform !== "Instagram" ? <p className="pv-text">{text.slice(0, isX ? 280 : 300)}{text.length > (isX ? 280 : 300) ? "…" : ""}</p> : null}
      {img ? <img src={img} alt="" /> : platform === "X" || !hasImage ? null : <div className="pv-noimg">Approved image</div>}
      {platform === "Instagram" ? <p className="pv-text"><strong>{handle}</strong> {text.slice(0, 180)}{text.length > 180 ? "… more" : ""}</p> : null}
      {hashtags ? <p className="pv-tags">{hashtags}</p> : null}
    </div>
  );
}

/* ---------- 8 · Schedule ---------- */
function StageSchedule({ d, load, push, onDone }: { d: Detail; load: () => Promise<void>; push: Push; onDone: () => void }) {
  const s = d.slot;
  const [times, setTimes] = useState<Record<string, string>>(() => Object.fromEntries(d.content.map((c) => [c.platform, (c.scheduled_at ? toLocal(c.scheduled_at) : `${s.date}T${s.time}`)])));
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const push2 = async () => {
    setBusy(true);
    try {
      for (const c of d.content) {
        const t = times[c.platform];
        if (t) await postJson(`/api/slots/${s.id}/content`, { platform: c.platform, scheduled_at: new Date(t).toISOString() });
      }
      const r = await postJson<{ scheduled: number }>(`/api/slots/${s.id}/schedule`, {});
      push(`Scheduled ${r.scheduled} post${r.scheduled > 1 ? "s" : ""} on the calendar`, "ok");
      await load();
      onDone();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const markPosted = async (p: Post) => {
    const url = (urls[p.id] || "").trim();
    if (!url) return push("Paste the live post link", "bad");
    try {
      await postJson("/api/posts", { id: p.id, status: "posted", posted_url: url }, "PATCH");
      const left = d.posts.filter((x) => x.id !== p.id && x.status !== "posted").length;
      if (!left) await postJson("/api/slots", { id: s.id, status: "posted" }, "PATCH");
      push(`${p.platform} marked posted`, "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };

  const so = d.approvals;
  const locked = so.required > 0 && !so.ready && !d.posts.length;
  return (
    <div className="stack">
      <SignOffPanel d={d} load={load} push={push} />
      <section className="panel stack">
        <div className="panel-head"><h3>When should each post go out?</h3>{locked ? <Pill tone="warn">Locked until sign-off</Pill> : null}</div>
        <div className="list">
          {d.content.map((c) => (
            <div key={c.id} className="list-item" style={{ gridTemplateColumns: "auto 1fr auto" }}>
              {d.final ? <img className="mini" src={fileUrl(d.final.file_id)} alt="" /> : <div className="mini empty">Text</div>}
              <div><strong>{c.platform}</strong><p>{c.caption.slice(0, 80)}{c.caption.length > 80 ? "…" : ""}</p></div>
              <input className="input" type="datetime-local" style={{ width: 220 }} value={times[c.platform] || ""} onChange={(e) => setTimes((t) => ({ ...t, [c.platform]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="btn primary big" type="button" disabled={busy || !d.content.length || locked} onClick={push2}>{busy ? "Scheduling…" : s.status === "scheduled" || s.status === "posted" ? "Update the schedule" : "Schedule"}</button>
        </div>
        <p className="small muted">Scheduling here fills the calendar. To have it actually go out, send it to your channels below — or post it by hand and paste the live link.</p>
      </section>

      <SendToChannels d={d} push={push} />

      {d.posts.length ? (
        <section className="panel stack">
          <div className="panel-head"><h3>Posting</h3></div>
          <div className="list">
            {d.posts.map((p) => (
              <div key={p.id} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><strong>{p.platform}</strong><p>{fmtDate(p.scheduled_at)}{p.posted_url ? <> · <a href={p.posted_url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>live post</a></> : ""}</p></div>
                {p.status === "posted" ? (
                  <span className="actions"><Pill tone="ok">Posted</Pill><Link className="btn small" href={`/analytics?post=${p.id}`}>Add results</Link></span>
                ) : (
                  <span className="actions">
                    <input className="input" style={{ width: 220 }} value={urls[p.id] || ""} onChange={(e) => setUrls((u) => ({ ...u, [p.id]: e.target.value }))} placeholder="Paste live link" />
                    <button className="btn small" type="button" onClick={() => markPosted(p)}>Mark posted</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

    </div>
  );
}
/* Named people approve the exact image and captions before anything is scheduled. */
function SignOffPanel({ d, load, push }: { d: Detail; load: () => Promise<void>; push: Push }) {
  const so = d.approvals;
  const [bases, setBases] = useState<{ local: string; network: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ bases: { local: string; network: string[] } }>(`/api/slots/${d.slot.id}/approvals`).then((r) => setBases(r.bases)).catch(() => null); }, [d.slot.id]);
  // decisions arrive from other people's review links: keep the page fresh while waiting
  useEffect(() => {
    if (!so.requested || so.ready) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [so.requested, so.ready, load]);
  const request = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ requested: number }>(`/api/slots/${d.slot.id}/approvals`, { action: "request" });
      push(r.requested ? `Review links ready for ${r.requested} ${r.requested === 1 ? "person" : "people"}. Send each person their link.` : "Everyone already has a link for this version", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const base = bases?.network[0] || bases?.local || "";
  const linkFor = (i: SignItem) => `${base}/review/${i.token}`;
  const copy = (i: SignItem) => navigator.clipboard.writeText(linkFor(i)).then(() => push(`Link for ${i.name} copied`, "ok"));
  if (!so.approvers) {
    return (
      <section className="panel stack" style={{ gap: 8 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>Sign-off</h3><Pill>Not set up</Pill></div>
        <p className="small muted" style={{ margin: 0 }}>Add the people who must approve posts, like your founder or marketing lead, in <Link href="/settings" style={{ textDecoration: "underline" }}>Settings</Link>. Until then posts can be scheduled without sign-off.</p>
      </section>
    );
  }
  const needsNew = so.items.some((i) => !i.id || i.stale || i.status === "changes");
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Sign-off</h3>
        {so.ready ? <Pill tone="ok">Approved</Pill> : so.changes ? <Pill tone="bad">Changes requested</Pill> : so.requested ? <Pill tone="warn">{so.approved} of {so.required} approved</Pill> : <Pill>Not requested</Pill>}
      </div>
      <div className="sign-list">
        {so.items.map((i) => (
          <div key={i.approver_id} className={`sign-row st-${i.id && !i.stale ? i.status : "none"}`}>
            <div className="sign-who"><strong>{i.name}</strong><small>{[i.role, i.required ? "must approve" : "optional"].filter(Boolean).join(" · ")}</small></div>
            <div className="sign-state">
              {!i.id ? <span className="muted">Not asked yet</span>
                : i.stale ? <span className="muted">Approved an older version. Ask again.</span>
                : i.status === "approved" ? <span className="ok-text">Approved {i.decided_at ? new Date(i.decided_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</span>
                : i.status === "changes" ? <span className="bad-text">Wants changes: &ldquo;{i.comment}&rdquo;</span>
                : <span className="muted">Waiting</span>}
            </div>
            {i.id && !i.stale && i.status === "pending" ? (
              <div className="actions">
                <button className="btn small" type="button" onClick={() => copy(i)}>Copy link</button>
                {i.email ? <a className="btn small ghost" href={`mailto:${i.email}?subject=${encodeURIComponent(`Please review: ${d.slot.topic}`)}&body=${encodeURIComponent(`Hi ${i.name},\n\nPlease review this post before it goes out on ${niceDate(d.slot.date)}:\n${linkFor(i)}\n\nThanks`)}`}>Email</a> : null}
                <a className="btn small ghost" href={linkFor(i)} target="_blank" rel="noreferrer">Open</a>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {needsNew ? <div className="actions"><button className="btn primary" type="button" disabled={busy} onClick={request}>{busy ? "Preparing…" : so.requested ? "Ask again for this version" : "Ask for sign-off"}</button></div> : null}
      {so.changes ? <p className="small muted" style={{ margin: 0 }}>Make the changes in Drafts, Refine or Captions. Saving them creates a new version, then ask again.</p> : null}
      {bases && !bases.network.length ? <p className="small muted" style={{ margin: 0 }}>Links work on this Mac only right now. Connect to Wi-Fi so people on the same network can open them.</p> : null}
    </section>
  );
}

function toLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- pictures you're allowed to use, searched on this post's topic ---------- */
type FreeImage = { key: string; title: string; thumb: string; alt_thumb?: string; full: string; page: string; source: string; creator: string; licence: string; width: number; height: number; reuse: "free" | "credit" | "check" };
const REUSE_LABEL: Record<FreeImage["reuse"], { label: string; tone: string }> = {
  free: { label: "free to use", tone: "ok" },
  credit: { label: "credit the maker", tone: "info" },
  check: { label: "check the licence", tone: "warn" },
};

function FreeImageSearch({ slot, terms, onAdded, push }: { slot: Slot; terms: string[]; onAdded: () => void; push: Push }) {
  const suggested = useMemo(() => {
    const rr = (slot.research || {}) as Record<string, unknown>;
    const kw = ((rr.keywords as string[] | undefined) || []).slice(0, 3);
    return (kw.length ? kw.join(" ") : terms.slice(0, 3).join(" ")) || slot.topic;
  }, [slot.research, slot.topic, terms]);
  const [q, setQ] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ images: FreeImage[]; errors: string[]; google: string } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const search = async (text = q) => {
    if (!text.trim()) return push("Type what the picture should show", "bad");
    setBusy(true);
    setSel(new Set());
    try {
      setRes(await api<{ images: FreeImage[]; errors: string[]; google: string }>(`/api/inspiration/images?q=${encodeURIComponent(text)}`));
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const chosen = (res?.images || []).filter((i) => sel.has(i.key));
    if (!chosen.length) return;
    setSaving(true);
    try {
      const r = await postJson<{ created: { id: string }[]; skipped: string[] }>("/api/inspiration/images", { images: chosen, competitor: "" });
      if (r.created.length) await postJson(`/api/slots/${slot.id}/samples`, { inspiration_ids: r.created.map((c) => c.id) });
      push(r.created.length ? `Added ${r.created.length} picture${r.created.length === 1 ? "" : "s"} as references` : "Those are already saved", r.created.length ? "ok" : "");
      setSel(new Set());
      onAdded();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Search pictures you can use</h3>
        {res ? <Pill>{res.images.length} found</Pill> : null}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Searches the open picture libraries Google Images itself indexes — Flickr, Wikimedia, museums — where everything is Creative Commons or public domain. The licence and the person to credit come with each one.
      </p>
      <div className="fetch-row">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What should the picture show?" onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="btn primary" type="button" disabled={busy} onClick={() => search()}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {res?.errors?.length ? <div className="note small">Couldn&apos;t reach: {res.errors.join(" · ")}</div> : null}
      {res && !res.images.length && !busy ? <p className="small muted" style={{ margin: 0 }}>Nothing came back. Try plainer words — &ldquo;rider helmet city&rdquo; rather than a whole sentence.</p> : null}
      {res?.images.length ? (
        <>
          <div className="save-bar">
            <span className="count">{sel.size} chosen</span>
            <button className="btn small ghost" type="button" onClick={() => setSel(new Set())}>Clear</button>
            <button className="btn small primary" type="button" disabled={!sel.size || saving} onClick={add}>{saving ? "Adding…" : `Add ${sel.size || ""} as references`}</button>
          </div>
          <div className="src-grid">
            {res.images.map((i) => (
              <div key={i.key} className={`src-card ${sel.has(i.key) ? "on" : ""}`} onClick={() => setSel((x) => { const n = new Set(x); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })}>
                <div className="pic"><ProxyImg src={i.thumb} fallbacks={[i.alt_thumb || "", i.full]} alt={i.title} /></div>
                <span className="tick">{sel.has(i.key) ? "✓" : ""}</span>
                <span className={`match-tag ${i.reuse}`}>{REUSE_LABEL[i.reuse].label}</span>
                <div className="meta">
                  <strong>{i.title}</strong>
                  <span>{i.licence}{i.creator ? ` · ${i.creator}` : ""}</span>
                  <a href={i.page} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Where it&apos;s from ↗</a>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {res?.google ? (
        <p className="small muted" style={{ margin: 0 }}>
          Not what you wanted? <a href={res.google} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Open Google Images filtered to reusable pictures ↗</a> and upload what you find below. Google&apos;s own search can&apos;t be read by an app without a paid key, so that part stays manual.
        </p>
      ) : null}
    </section>
  );
}

/* ---------- the words that go on the picture ---------- */
type PosterLine = { line: string; sub?: string; style?: string; note?: string };

function PosterCopy({ d, load, push }: { d: Detail; load: () => Promise<void>; push: Push }) {
  const r = (d.slot.research || {}) as Record<string, unknown>;
  const lines = (r.poster_copy as PosterLine[] | undefined) || [];
  const open = d.poster_job === "queued" || d.poster_job === "running";
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const ask = async () => {
    setBusy(true);
    try {
      await postJson(`/api/slots/${d.slot.id}/postercopy`, {});
      push("ChatGPT is writing the picture text. About a minute.", "ok");
      await load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const copy = (l: PosterLine) => {
    const text = [l.line, l.sub].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(() => { setCopied(l.line); setTimeout(() => setCopied(""), 1800); });
  };

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Words for the picture</h3>
        <span className="actions">
          {lines.length ? <Pill tone="ok">{lines.length} options</Pill> : null}
          <button className="btn small" type="button" disabled={busy || open} onClick={ask}>{open ? "Writing…" : busy ? "Asking…" : lines.length ? "Write new ones" : "Suggest the text"}</button>
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The line that sits on the image itself, not the caption underneath. Copy one and give it to ChatGPT or Higgsfield when you refine the draft, or put it on the slide in step 7.
      </p>
      {open ? <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>ChatGPT is writing eight options</strong>A benefit line, a rider&apos;s question, a number, something festive, a short stamp.</div> : null}
      {lines.length ? (
        <div className="poster-lines">
          {lines.map((l) => (
            <div key={l.line} className="poster-line">
              <div>
                <strong>{l.line}</strong>
                {l.sub ? <span className="sub">{l.sub}</span> : null}
                {l.note ? <p>{l.note}</p> : null}
              </div>
              <span className="actions">
                {l.style ? <Pill>{l.style}</Pill> : null}
                <button className="btn small" type="button" onClick={() => copy(l)}>{copied === l.line ? "Copied" : "Copy"}</button>
              </span>
            </div>
          ))}
        </div>
      ) : !open ? <p className="small muted" style={{ margin: 0 }}>Nothing yet. Press Suggest the text and ChatGPT writes eight, from this post&apos;s topic and angle.</p> : null}
    </section>
  );
}

/* A picture that keeps trying: the sized thumbnail, then the library's own thumbnail, then the
   full file, and finally through Circuit itself for libraries that refuse to be shown elsewhere.
   Openverse in particular answers 424 for some thumbnails, which used to leave gaps in the grid. */
function ProxyImg({ src, fallbacks = [], alt }: { src: string; fallbacks?: string[]; alt: string }) {
  const chain = useMemo(() => {
    const direct = [src, ...fallbacks].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
    return [...direct, ...direct.map((u) => `/api/inspiration/preview?url=${encodeURIComponent(u)}`)];
  }, [src, fallbacks]);
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [src]);
  if (at >= chain.length) return <span className="small muted">No preview</span>;
  return <img src={chain[at]} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setAt((n) => n + 1)} />;
}

/* ---------- handing the finished post to the platforms ---------- */
type PlanItem = { platform: string; caption: string; channelId: string; ready: boolean };
type PostizPlan = {
  connected: boolean; error: string; map: Record<string, string>; self_hosted: boolean;
  plan: { file_id: string | null; when: string; items: PlanItem[] };
};

function SendToChannels({ d, push }: { d: Detail; push: Push }) {
  const [st, setSt] = useState<PostizPlan | null>(null);
  const [busy, setBusy] = useState("");
  const [sent, setSent] = useState<{ type: string; platforms: string[] } | null>(null);
  const load = useCallback(() => api<PostizPlan>(`/api/postiz?slot=${d.slot.id}`).then(setSt).catch(() => null), [d.slot.id]);
  useEffect(() => { load(); }, [load]);

  const send = async (type: "draft" | "schedule") => {
    if (type === "schedule" && !confirm("Schedule these on the real accounts? Postiz will publish them at the time set above.")) return;
    setBusy(type);
    try {
      const r = await postJson<{ sent: string[]; type: string }>("/api/postiz", { action: "send", slot_id: d.slot.id, type });
      setSent({ type: r.type, platforms: r.sent });
      push(r.type === "draft" ? `Sent to Postiz as a draft for ${r.sent.join(", ")}` : `Scheduled on ${r.sent.join(", ")}`, "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  if (!st) return null;
  const ready = st.plan.items.filter((i) => i.ready);
  const blocked = st.plan.items.filter((i) => !i.ready);

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Send it to your channels</h3>
        {st.connected ? <Pill tone={ready.length ? "ok" : "warn"}>{ready.length} ready</Pill> : <Pill tone="warn">Not connected</Pill>}
      </div>

      {!st.connected ? (
        <p className="small muted" style={{ margin: 0 }}>
          Connect Postiz in <Link href="/settings" style={{ textDecoration: "underline" }}>Settings</Link> and Circuit can hand the approved picture and each caption straight to Instagram, Facebook and LinkedIn. Until then, post by hand and paste the link above.
        </p>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            The approved picture and each platform&apos;s own caption, at the time set above. A draft waits in Postiz for you to press publish; scheduling sends it at that time without asking again.
          </p>
          <div className="list">
            {st.plan.items.map((i) => (
              <div key={i.platform} className="list-item" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <span className={`dot ${i.ready ? "ok" : "warn"}`} />
                <div><strong>{i.platform}</strong><p>{i.caption ? `${i.caption.slice(0, 70)}${i.caption.length > 70 ? "…" : ""}` : "No caption written yet"}</p></div>
                <span className="small muted">{i.channelId ? "channel matched" : "no channel matched"}</span>
              </div>
            ))}
          </div>
          {blocked.length ? <p className="small muted" style={{ margin: 0 }}>{blocked.map((b) => b.platform).join(", ")} can&apos;t be sent yet — each needs a caption and a channel matched in Settings.</p> : null}
          {sent ? <div className="note ok small"><strong>{sent.type === "draft" ? "Waiting in Postiz" : "Scheduled"}</strong>{sent.platforms.join(", ")}. {sent.type === "draft" ? "Open Postiz to publish it when you are happy." : "Postiz will publish at the time above."}</div> : null}
          <div className="actions">
            <button className="btn primary" type="button" disabled={!ready.length || Boolean(busy)} onClick={() => send("draft")}>{busy === "draft" ? "Sending…" : "Send as a draft"}</button>
            <button className="btn" type="button" disabled={!ready.length || Boolean(busy)} onClick={() => send("schedule")}>{busy === "schedule" ? "Scheduling…" : "Schedule on the accounts"}</button>
          </div>
        </>
      )}
    </section>
  );
}
