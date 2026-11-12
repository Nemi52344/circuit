"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, postJson, fileUrl } from "@/lib/api";
import { useToast } from "@/components/ui";

/* Content status: every piece of content on one board, a column per stage.

   Idea → Making → Sign-off → Scheduled → Posted, left to right, each column scrolling on its
   own so a long list of ideas never pushes the rest off the screen. A card reads top to
   bottom: the picture, the whole title, when and where, and — at the foot — the one thing to
   do with it. Posters are approved or sent back right on their card; videos skip sign-off.
   Ideas whose day has passed fold away under "Earlier" so the column shows what is next. */

type Column = { key: string; label: string; hint: string };
type Piece = {
  key: string; post_id: string | null; post_ids: string[]; slot_id: string | null; title: string; when: string; platform: string; format: string;
  is_video: boolean; file_id: string | null; caption: string; posted_url: string; decided_by: string; note: string;
  column: string; flag: string; line: string; stage: number; slides: number;
};
type Data = { pieces: Piece[]; columns: Column[]; today: string; can_approve: boolean };

const STAGE_TONE: Record<string, string> = { idea: "#8C918C", making: "#2563EB", signoff: "#D97706", scheduled: "#7C3AED", posted: "#10A37E" };
const SHORT: Record<string, string> = { idea: "Idea", making: "Making", signoff: "Sign-off", scheduled: "Scheduled", posted: "Posted" };
const DAY = 86400000;
const dayDiff = (iso: string, today: string) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
const dayLabel = (iso: string, today: string) => {
  const d = dayDiff(iso, today);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
};

/* ---- small pieces ---- */

function PlatformIcon({ name }: { name: string }) {
  const n = name.trim().toLowerCase();
  const path = n.startsWith("insta") ? <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" /></>
    : n.startsWith("face") ? <path d="M14 8h3V4.5h-3c-2.3 0-4 1.8-4 4V11H7.5v3.5H10V21h3.5v-6.5h3l.5-3.5h-3.5V8.8c0-.5.3-.8.5-.8z" fill="currentColor" stroke="none" />
    : n.startsWith("linked") ? <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7.5 10.5V17M7.5 7.3v.2M11 17v-6.5M11 13.5c0-1.8 1-3 2.6-3 1.6 0 2.4 1.1 2.4 3V17" /></>
    : n === "x" || n.startsWith("twit") ? <path d="M4 4l16 16M20 4L4 20" />
    : n.startsWith("blog") ? <><path d="M5 4h10l4 4v12H5z" /><path d="M8 12h8M8 16h6" /></>
    : <circle cx="12" cy="12" r="8" />;
  return <span className="cs2-pf" title={name.trim()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg></span>;
}
const Platforms = ({ list }: { list: string }) => <span className="cs2-pfs" aria-label={list}>{list.split(",").filter((x) => x.trim()).map((p) => <PlatformIcon key={p} name={p} />)}</span>;

/* A picture when there is one; otherwise a tile that still says what the piece is. */
function Thumb({ p, size = "md" }: { p: Piece; size?: "sm" | "md" | "lg" }) {
  const tone = p.is_video ? 265 : p.format === "carousel" ? 215 : p.format === "text" ? 30 : 150;
  return (
    <span className={`cs2-thumb ${size}`} style={{ ["--h" as string]: tone }}>
      {p.file_id ? (p.is_video ? <video src={`${fileUrl(p.file_id)}#t=1`} preload="metadata" muted playsInline /> : <img src={fileUrl(p.file_id)} alt="" loading="lazy" />)
        : <span className="cs2-thumb-ph"><small>{p.is_video ? "Video" : p.format === "carousel" ? "Carousel" : p.format === "text" ? "Text" : "Image"}</small></span>}
      {p.is_video && p.file_id ? <b className="cs2-tag">Video</b> : p.slides > 1 ? <b className="cs2-tag">{p.slides} slides</b> : null}
    </span>
  );
}

function StageBadge({ p }: { p: Piece }) {
  return <span className="cs2-stage" style={{ ["--c" as string]: STAGE_TONE[p.column] }}><i />{SHORT[p.column]}{p.column === "idea" || p.column === "making" ? <em>{p.stage}/8</em> : null}</span>;
}

function Flag({ p }: { p: Piece }) {
  if (p.flag === "sent_back") return <span className="cs2-flag bad">Sent back</span>;
  if (p.flag === "late") return <span className="cs2-flag bad">Past its day</span>;
  if (p.flag === "due") return <span className="cs2-flag due">Due today</span>;
  if (p.flag === "stale") return <span className="cs2-flag warn">Edited after approval</span>;
  return null;
}

/* ---- the page ---- */

export default function ContentStatusPage() {
  const { push, view } = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [kind, setKind] = useState<"all" | "poster" | "video">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Piece | null>(null);
  const [backing, setBacking] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [earlier, setEarlier] = useState<Record<string, boolean>>({});

  const load = useCallback(() => api<Data>("/api/content").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible" && !open && !backing) load(); }, 30000); return () => clearInterval(t); }, [load, open, backing]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setBacking(""); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.pieces || []).filter((p) => (kind === "all" || (kind === "video" ? p.is_video : !p.is_video)) && (!needle || `${p.title} ${p.caption} ${p.platform}`.toLowerCase().includes(needle)));
  }, [d, kind, q]);

  const decide = async (p: Piece, decision: "approved" | "rejected") => {
    if (decision === "rejected" && !note.trim()) return push("Say what needs changing, so it can be fixed", "bad");
    setBusy(p.key);
    try {
      for (const id of p.post_ids) await postJson("/api/signoff", { id, decision, note: decision === "rejected" ? note.trim() : "" });
      push(decision === "approved" ? `Approved — “${p.title}” is scheduled` : "Sent back with your note", "ok");
      setBacking(""); setNote(""); setOpen(null);
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };
  const publish = async (p: Piece) => {
    if (!p.post_ids.length || !confirm(`Publish “${p.title}” to ${p.platform} now? On Instagram a post cannot be taken back.`)) return;
    setBusy(p.key);
    try {
      const failed: string[] = [];
      for (const id of p.post_ids) { const r = await postJson<{ ok: boolean; error: string }>("/api/posting", { action: "publish", id }); if (!r.ok) failed.push(r.error); }
      push(failed.length ? failed.join(" · ") : `Published to ${p.platform}`, failed.length ? "bad" : "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  if (!d) return <div className="stack">{view}<div className="wk-skeleton" /></div>;
  const today = d.today;
  const col = (k: string) => shown.filter((p) => p.column === k).sort((a, b) => (k === "posted" ? b.when.localeCompare(a.when) : a.when.localeCompare(b.when)));
  const waiting = col("signoff").filter((p) => p.flag !== "sent_back").length;
  const late = shown.filter((p) => p.flag === "late" && p.column !== "posted").length;

  const shortDay = (iso: string) => {
    const n = dayDiff(iso, today);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: n > -7 && n < 7 ? "short" : undefined, day: "numeric", month: "short", timeZone: "UTC" });
  };

  /* One card. The picture across the top when there is one; the action at the foot. */
  const card = (p: Piece) => {
    const progress = p.column === "idea" || p.column === "making";
    return (
      <article key={p.key} className={`cb-card ${p.flag ? `is-${p.flag}` : ""}`}>
        <button type="button" className="cb-open" onClick={() => setOpen(p)} aria-label={`Open ${p.title}`}>
          {p.file_id ? (
            <span className="cb-pic">
              {p.is_video ? <video src={`${fileUrl(p.file_id)}#t=1`} preload="metadata" muted playsInline /> : <img src={fileUrl(p.file_id)} alt="" loading="lazy" />}
              {p.is_video ? <b className="cs2-tag">Video</b> : p.slides > 1 ? <b className="cs2-tag">{p.slides} slides</b> : null}
            </span>
          ) : null}
          <span className="cb-body">
            <span className="cb-top">
              {!p.file_id ? <Thumb p={p} size="sm" /> : null}
              <strong>{p.title}</strong>
            </span>
            <span className="cb-meta">
              <span className={`cb-day ${p.flag === "late" ? "late" : dayDiff(p.when, today) === 0 ? "today" : ""}`}>{shortDay(p.when)}</span>
              <Platforms list={p.platform} />
              <Flag p={p} />
            </span>
            {progress ? <span className="cb-progress" title={`Stage ${p.stage} of 8`}><i style={{ width: `${(p.stage / 8) * 100}%`, background: STAGE_TONE[p.column] }} /></span> : null}
            <span className="cs2-line">{p.flag === "sent_back" && p.note ? `${(p.decided_by || "Manager").split(" ")[0]}: “${p.note}”` : p.line}</span>
          </span>
        </button>

        {p.column === "signoff" && d.can_approve ? (
          backing === p.key ? (
            <div className="cb-back">
              <textarea className="textarea" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs changing?" />
              <div className="cb-actions"><button type="button" className="btn small" disabled={busy === p.key || !note.trim()} onClick={() => decide(p, "rejected")}>Send back</button><button type="button" className="btn small ghost" onClick={() => { setBacking(""); setNote(""); }}>Cancel</button></div>
            </div>
          ) : p.flag === "sent_back" ? (
            <div className="cb-actions">{p.slot_id ? <Link className="btn small" href={`/slot/${p.slot_id}`}>Open to change</Link> : null}<button type="button" className="btn small ghost" disabled={busy === p.key} onClick={() => decide(p, "approved")}>Approve anyway</button></div>
          ) : (
            <div className="cb-actions two">
              <button type="button" className="btn small primary" disabled={busy === p.key} onClick={() => decide(p, "approved")}>Approve</button>
              <button type="button" className="btn small" onClick={() => { setBacking(p.key); setNote(""); }}>↩ Send back</button>
            </div>
          )
        ) : p.column === "scheduled" && (p.flag === "due" || p.flag === "late") ? (
          <div className="cb-actions"><button type="button" className="btn small primary" disabled={busy === p.key} onClick={() => publish(p)}>{busy === p.key ? "Publishing…" : "Publish now"}</button></div>
        ) : p.column === "posted" && p.posted_url ? (
          <div className="cb-actions"><a className="btn small ghost" href={p.posted_url} target="_blank" rel="noreferrer">See it live ↗</a></div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="stack cb">
      {view}
      <div className="wk-head">
        <div>
          <h1>Content status</h1>
          <p className="lede" style={{ margin: 0 }}>
            {shown.filter((p) => p.column !== "posted").length} pieces on the go{waiting ? ` · ${waiting} poster${waiting === 1 ? "" : "s"} to sign off` : ""}{late ? ` · ${late} past their day` : ""}
          </p>
        </div>
        <div className="wk-head-right">
          <input className="input wk-search" placeholder="Search content…" aria-label="Search content" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="wk"><div className="seg" role="tablist" aria-label="Which content">
            {([["all", "All"], ["poster", "Posters"], ["video", "Videos"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}
          </div></div>
          <Link className="btn small" href="/">Calendar</Link>
        </div>
      </div>

      {/* Every column on screen at once. A column with nothing in it gets a narrower share, so
          the busy ones have room for their cards. */}
      <div className="cb-board" style={{ gridTemplateColumns: d.columns.map((c) => (col(c.key).length ? "minmax(0, 1fr)" : "minmax(0, .6fr)")).join(" ") }}>
        {d.columns.map((c) => {
          const list = col(c.key);
          /* Ideas and work whose day has gone fold away: the column shows what is next. */
          const foldable = c.key === "idea" || c.key === "making";
          const past = foldable ? list.filter((p) => dayDiff(p.when, today) < 0) : [];
          const current = foldable ? list.filter((p) => dayDiff(p.when, today) >= 0) : list;
          const attention = c.key === "signoff" && waiting > 0;
          return (
            <section key={c.key} className={`cb-col ${attention ? "attn" : ""}`} style={{ ["--c" as string]: STAGE_TONE[c.key] }} aria-label={c.label}>
              <header className="cb-col-head">
                <span className="cb-dot" />
                <strong>{SHORT[c.key]}</strong>
                <span className="cb-count">{list.length}</span>
              </header>
              <p className="cb-hint">{c.key === "signoff" && !d.can_approve ? "Waiting for the manager" : c.hint}</p>
              <div className="cb-list">
                {current.map(card)}
                {past.length ? (
                  <>
                    <button type="button" className="cb-earlier" onClick={() => setEarlier((e) => ({ ...e, [c.key]: !e[c.key] }))} aria-expanded={Boolean(earlier[c.key])}>
                      {earlier[c.key] ? "Hide" : "Show"} {past.length} earlier — their day has passed
                    </button>
                    {earlier[c.key] ? past.map(card) : null}
                  </>
                ) : null}
                {!list.length ? <p className="cb-empty">{c.key === "signoff" ? "No posters waiting." : c.key === "scheduled" ? "Approved posters and finished videos wait here for their day." : c.key === "posted" ? "Published posts from the last 30 days." : "Nothing here."}</p> : null}
              </div>
            </section>
          );
        })}
      </div>

      {open ? (
        <>
          <div className="wk-scrim" onClick={() => setOpen(null)} />
          <aside className="wk-drawer cs2-drawer" role="dialog" aria-label={open.title}>
            <div className="wk-drawer-head"><h3 style={{ margin: 0, flex: 1 }}>{open.title}</h3><button type="button" className="tb-btn" aria-label="Close" onClick={() => setOpen(null)}>×</button></div>
            <div className="cs2-review-top"><StageBadge p={open} /><Platforms list={open.platform} /><span className="small muted">{dayLabel(open.when, today)} · {open.when.slice(11, 16) || "18:00"}</span><Flag p={open} /></div>
            {open.file_id ? (open.is_video
              ? <video className="cs-media" src={fileUrl(open.file_id)} controls playsInline preload="metadata" />
              : <img className="cs-media" src={fileUrl(open.file_id)} alt={open.title} />) : <Thumb p={open} size="lg" />}
            <p className="small muted" style={{ margin: 0 }}>{open.line}</p>
            {open.flag === "sent_back" && open.note ? <div className="wk-why"><strong>{open.decided_by}:</strong> {open.note}</div> : null}
            {open.caption ? <div className="wk-why" style={{ whiteSpace: "pre-wrap" }}>{open.caption}</div> : null}
            <div className="actions">
              {open.column === "signoff" && d.can_approve && open.flag !== "sent_back" ? <button type="button" className="btn primary" disabled={busy === open.key} onClick={() => decide(open, "approved")}>Approve{open.post_ids.length > 1 ? ` for ${open.post_ids.length} platforms` : ""}</button> : null}
              {open.column === "scheduled" && (open.flag === "due" || open.flag === "late") ? <button type="button" className="btn primary" disabled={busy === open.key} onClick={() => publish(open)}>Publish now</button> : null}
              {open.slot_id ? <Link className="btn" href={`/slot/${open.slot_id}`}>Open in the calendar</Link> : null}
              {open.posted_url ? <a className="btn" href={open.posted_url} target="_blank" rel="noreferrer">See it live ↗</a> : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
