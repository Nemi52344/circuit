"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, postJson, fileUrl, downloadUrl, fmtDate, PLATFORMS } from "@/lib/api";
import { Pill, Empty, Modal, ImageViewer, useToast, statusTone } from "@/components/ui";
import type { ViewerItem } from "@/components/ui";
import type { Creation } from "@/lib/types";

const FILTERS: { key: string; label: string; test: (c: Creation) => boolean }[] = [
  { key: "review", label: "Needs review", test: (c) => c.status === "generated" || c.status === "saved" },
  { key: "approved", label: "Approved", test: (c) => c.status === "approved" },
  { key: "rejected", label: "Rejected", test: (c) => c.status === "rejected" },
  { key: "all", label: "All", test: () => true },
];

type Aspect = { w: number; h: number; label: string; where: string };
type Check = { key: string; label: string; hint: string };
type Safe = { top: number; bottom: number; side: number };
type WallMeta = { aspects: Record<string, Aspect>; checks: Check[]; text_safe: Record<string, Safe> };
type Note = { id: string; author: string; body: string; created_at: string };
type Version = { id: string; title: string; step: number; round: number; status: string; file_id: string; created_at: string; notes: number; current: boolean };
type Thread = { notes: Note[]; versions: Version[] };

export default function WallPage() {
  const [items, setItems] = useState<Creation[]>([]);
  const [meta, setMeta] = useState<WallMeta | null>(null);
  const [filter, setFilter] = useState("review");
  const [scheduling, setScheduling] = useState<Creation | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [guide, setGuide] = useState("");
  /* The picture whose notes and versions are open. */
  const [thread, setThread] = useState<Creation | null>(null);
  const [threadData, setThreadData] = useState<Thread | null>(null);
  const [noteText, setNoteText] = useState("");
  const { push, view } = useToast();

  const load = () => api<Creation[]>("/api/creations").then(setItems).catch((e: Error) => push(e.message, "bad"));

  const openThread = async (c: Creation) => {
    setThread(c);
    setThreadData(null);
    setNoteText("");
    try {
      setThreadData(await api<Thread>(`/api/creations/thread?id=${c.id}`));
    } catch (e) { push((e as Error).message, "bad"); }
  };

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thread || !noteText.trim()) return;
    try {
      await postJson("/api/creations/thread", { creation_id: thread.id, body: noteText });
      setNoteText("");
      setThreadData(await api<Thread>(`/api/creations/thread?id=${thread.id}`));
      load();
    } catch (err) { push((err as Error).message, "bad"); }
  };

  const dropNote = async (id: string) => {
    if (!thread || !confirm("Remove this note?")) return;
    try {
      await api(`/api/creations/thread?id=${id}`, { method: "DELETE" });
      setThreadData(await api<Thread>(`/api/creations/thread?id=${thread.id}`));
      load();
    } catch (err) { push((err as Error).message, "bad"); }
  };
  useEffect(() => {
    load();
    api<WallMeta>("/api/creations", { method: "PUT" }).then(setMeta).catch(() => { /* the shapes are a convenience, not a dependency */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (c: Creation, status: string) => {
    try {
      await postJson("/api/creations", { id: c.id, status }, "PATCH");
      push(`${c.title || "Creation"} ${status}`, status === "approved" ? "ok" : "");
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };

  /* Ticking a check saves immediately. Half a checklist that vanished on reload would be
     worse than none, because you would believe it had been done. */
  const tickQa = async (c: Creation, key: string, on: boolean) => {
    try {
      await postJson("/api/creations", { id: c.id, qa: { [key]: on } }, "PATCH");
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };

  const exportShape = async (c: Creation, aspect: string) => {
    setBusyId(c.id);
    try {
      const r = await postJson<{ w: number; h: number }>("/api/creations", { id: c.id, action: "export", aspect }, "PATCH");
      push(`Exported at ${r.w}×${r.h} — it is on the wall`, "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusyId(null); }
  };

  const writeCaption = async (c: Creation) => {
    setBusyId(c.id);
    push("Asking ChatGPT for a caption…");
    try {
      const r = await postJson<{ caption: string }>("/api/creations", { id: c.id, action: "caption" }, "PATCH");
      push(r.caption.slice(0, 90), "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusyId(null); }
  };
  const remove = async (c: Creation) => {
    if (!confirm("Delete this creation and its image?")) return;
    await api(`/api/creations?id=${c.id}`, { method: "DELETE" });
    load();
  };
  const schedule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scheduling) return;
    const fd = new FormData(e.currentTarget);
    const local = String(fd.get("when") || "");
    if (!local) return push("Pick a date and time", "bad");
    setBusy(true);
    try {
      await postJson("/api/posts", {
        platform: fd.get("platform"),
        scheduled_at: new Date(local).toISOString(),
        caption: fd.get("caption"),
        creation_id: scheduling.id,
        file_id: scheduling.file_id,
      });
      if (scheduling.status !== "approved") await postJson("/api/creations", { id: scheduling.id, status: "approved" }, "PATCH");
      push("Post planned. It sits as a draft in the calendar until you approve it.", "ok");
      setScheduling(null);
      load();
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const active = FILTERS.find((f) => f.key === filter)!;
  const shown = items.filter(active.test);
  const viewItems = useMemo<ViewerItem[]>(() => shown.map((c) => ({
    id: c.id,
    src: fileUrl(c.file_id),
    title: c.title || "Untitled creation",
    subtitle: fmtDate(c.created_at),
    tags: [{ label: c.status, tone: statusTone(c.status) }, { label: c.mode === "gemini" ? c.model : c.mode }],
    fields: [
      { label: "Made from", value: [c.competitor ? `${c.competitor} reference` : "", c.product_name ? `${c.product_name}${c.product_color ? ` ${c.product_color}` : ""}` : ""].filter(Boolean).join(" · ") || "Nothing recorded" },
      ...(c.post_count ? [{ label: "Planned", value: `${c.post_count} post${c.post_count > 1 ? "s" : ""}` }] : []),
      ...(c.prompt ? [{ label: "Prompt", value: c.prompt }] : []),
    ],
  })), [shown]);

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Wall</h2>
          <p className="lede">Your created images. Approve the ones you want to post, then schedule them.</p>
        </div>
        <div className="row tight wrap">
          <div className="tabs">{FILTERS.map((f) => <button key={f.key} type="button" className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>{f.label} ({items.filter(f.test).length})</button>)}</div>
          <select className="input small" aria-label="Show the text-safe guide for a shape" value={guide} onChange={(e) => setGuide(e.target.value)}>
            <option value="">No guide</option>
            {Object.entries(meta?.aspects || {}).map(([k, a]) => <option key={k} value={k}>Guide: {a.label}</option>)}
          </select>
        </div>
      </div>

      {shown.length ? (
        <div className="grid-cards">
          {shown.map((c) => (
            <div key={c.id} className="card">
              <div className="thumb square" style={{ cursor: "zoom-in" }} onClick={() => setAt(shown.findIndex((x) => x.id === c.id))}>
                <img src={fileUrl(c.file_id)} alt={c.title} />
                {/* A guide, drawn over the picture, never written into it. */}
                {guide && meta?.text_safe?.[guide] ? (
                  <span className="safe" style={{
                    ["--safe-top" as string]: `${meta.text_safe[guide].top}%`,
                    ["--safe-bottom" as string]: `${meta.text_safe[guide].bottom}%`,
                    ["--safe-side" as string]: `${meta.text_safe[guide].side}%`,
                  }} />
                ) : null}
                <span className="tag"><Pill tone={statusTone(c.status)}>{c.status}</Pill></span>
              </div>
              <div className="body">
                <strong>{c.title || "Untitled"}</strong>
                <p>{c.mode === "gemini" ? c.model : c.mode} · {fmtDate(c.created_at)}</p>
                <p>{[c.competitor ? `from ${c.competitor}` : "", c.product_name ? `${c.product_name}${c.product_color ? ` ${c.product_color}` : ""}` : ""].filter(Boolean).join(" · ") || "No source recorded"}</p>
                {c.post_count ? <Pill tone="info">{c.post_count} post{c.post_count > 1 ? "s" : ""} planned</Pill> : null}

                {/* Where this one sits among its versions, and what was said about it. The card
                    is already busy, so this is one line that opens the rest. */}
                <button className="chain-line" type="button" onClick={() => openThread(c)}
                  title="Notes on this picture, and the versions it came from">
                  {/* No version number here on purpose: the card knows the pipeline's counter,
                      which is not a position in the chain. The dialog works the real one out. */}
                  {c.parent_id || c.child_count ? <span className="vtag">in a chain</span> : null}
                  <span>{c.note_count ? `${c.note_count} note${c.note_count > 1 ? "s" : ""}` : "No notes yet"}</span>
                </button>

                {/* The four checks, on the card where Approve is — not behind a dialog nobody
                    opens. Approve stays disabled until all four are ticked, and says which one
                    is missing rather than simply refusing. */}
                <div className="qa">
                  {(meta?.checks || []).map((chk) => (
                    <label key={chk.key} className="qa-item" title={chk.hint}>
                      <input type="checkbox" checked={Boolean(c.qa?.[chk.key])} disabled={c.status === "approved"}
                        onChange={(e) => tickQa(c, chk.key, e.target.checked)} />
                      <span>{chk.label}</span>
                    </label>
                  ))}
                </div>

                <div className="row tight wrap">
                  <select className="input small" aria-label={`Export ${c.title || "this creation"} to a shape`}
                    value="" disabled={busyId === c.id}
                    onChange={(e) => { if (e.target.value) exportShape(c, e.target.value); e.target.value = ""; }}>
                    <option value="">Export a shape…</option>
                    {Object.entries(meta?.aspects || {}).map(([k, a]) => (
                      <option key={k} value={k}>{a.label} · {a.w}×{a.h}</option>
                    ))}
                  </select>
                  <button className="btn small" type="button" disabled={busyId === c.id}
                    onClick={() => writeCaption(c)}>
                    {c.caption_draft_id ? "Rewrite caption" : "Write caption"}
                  </button>
                  {c.caption_draft_id ? <Link className="btn small ghost" href="/drafts">See caption</Link> : null}
                </div>

                <div className="row">
                  {c.status !== "approved"
                    ? <button className="btn small primary" type="button" disabled={!c.qa_complete}
                        title={c.qa_complete ? "" : `Still to check: ${(c.qa_outstanding || []).join("; ")}`}
                        onClick={() => setStatus(c, "approved")}>Approve</button>
                    : <button className="btn small primary" type="button" onClick={() => setScheduling(c)}>Schedule</button>}
                  <span className="actions">
                    {c.status === "approved" ? null : <button className="btn small" type="button" onClick={() => setScheduling(c)}>Schedule</button>}
                    <button className="btn small" type="button" onClick={() => setAt(shown.findIndex((x) => x.id === c.id))}>View</button>
                    <button className="btn small ghost" type="button" onClick={() => downloadUrl(fileUrl(c.file_id), `${c.title || "creation"}.png`)}>Download</button>
                  </span>
                </div>
                <div className="row">
                  {c.status !== "rejected" ? <button className="btn small ghost" type="button" onClick={() => setStatus(c, "rejected")}>Reject</button> : <button className="btn small ghost" type="button" onClick={() => setStatus(c, "saved")}>Restore</button>}
                  <button className="btn small danger" type="button" onClick={() => remove(c)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={items.length ? "Nothing in this view" : "The wall is empty"} hint={items.length ? "Try another filter." : "Generate something in the studio or upload an assisted result."} />
      )}
      {!items.length ? <div className="actions"><Link className="btn primary" href="/creation">Open studio</Link></div> : null}

      {thread ? (
        <Modal title={thread.title || "Creation"} eyebrow="Notes and versions" onClose={() => { setThread(null); setThreadData(null); }}>
          <div className="stack">
            {/* Versions first: what the picture came from is the context the notes are read in. */}
            {threadData?.versions?.length ? (
              <section className="stack" style={{ gap: 8 }}>
                <strong className="small">How it got here</strong>
                {/* Grouped by step, not strung in a line. Five pictures made at the same stage
                    are five attempts at one version, and an arrow between them would claim a
                    progression that never happened. */}
                <div className="chain">
                  {[...new Set(threadData.versions.map((v) => v.step))].sort((a, b) => a - b).map((step, gi) => {
                    const group = threadData.versions.filter((v) => v.step === step);
                    return (
                      <Fragment key={step}>
                        {gi > 0 ? <i className="chain-arrow" aria-hidden="true">→</i> : null}
                        <div className="chain-step">
                          <span className="chain-step-label">
                            v{step}{group.length > 1 ? ` · ${group.length} tries` : ""}
                          </span>
                          <div className="chain-row">
                            {group.map((v) => (
                              <span key={v.id} className={`chain-item ${v.current ? "now" : ""}`}
                                title={`${fmtDate(v.created_at)} · ${v.status}${v.notes ? ` · ${v.notes} note${v.notes > 1 ? "s" : ""}` : ""}${v.current ? " · the one you are looking at" : ""}`}>
                                <img src={fileUrl(v.file_id)} alt="" />
                                {v.notes ? <b className="chain-notes">{v.notes}</b> : null}
                              </span>
                            ))}
                          </div>
                          {/* One word for the whole step: all five approved, or a mix. */}
                          <small className="muted">{[...new Set(group.map((v) => v.status))].join(" · ")}</small>
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </section>
            ) : (
              <p className="small muted">This picture has no earlier or later version — it was made once and not iterated on.</p>
            )}

            <section className="stack" style={{ gap: 8 }}>
              <strong className="small">What was said</strong>
              {threadData === null ? <p className="small muted">Reading…</p>
                : threadData.notes.length ? (
                  <div className="notes">
                    {threadData.notes.map((n) => (
                      <div key={n.id} className="note-row">
                        <div>
                          <strong className="small">{n.author || "someone"}</strong>
                          <small className="muted"> · {fmtDate(n.created_at)}</small>
                          <p>{n.body}</p>
                        </div>
                        <button className="btn small ghost" type="button" onClick={() => dropNote(n.id)}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : <p className="small muted">Nothing said about this one yet. If it is being rejected, the reason belongs here — the next round reads it.</p>}

              <form onSubmit={saveNote} className="stack" style={{ gap: 8 }}>
                <textarea className="textarea" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)}
                  placeholder="What is right or wrong with it, in your own words" />
                <div className="actions">
                  <button className="btn primary small" type="submit" disabled={!noteText.trim()}>Add note</button>
                </div>
              </form>
            </section>
          </div>
        </Modal>
      ) : null}

      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Wall" /> : null}
      {scheduling ? (
        <Modal title={`Plan a post: ${scheduling.title || "creation"}`} onClose={() => setScheduling(null)}>
          <form onSubmit={schedule} className="stack">
            <div className="cols-2">
              <img src={fileUrl(scheduling.file_id)} alt="" style={{ border: "1px solid var(--line)" }} />
              <div className="stack">
                <label className="field"><span>Platform</span><select className="select" name="platform" defaultValue="Instagram">{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></label>
                <label className="field"><span>Date and time (Asia/Kolkata, your local clock)</span><input className="input" type="datetime-local" name="when" required /></label>
                <label className="field"><span>Caption</span><textarea className="textarea" name="caption" rows={5} placeholder="Write the caption, or leave blank and draft it later." /></label>
              </div>
            </div>
            <div className="actions"><button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add to calendar"}</button><button className="btn ghost" type="button" onClick={() => setScheduling(null)}>Cancel</button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
