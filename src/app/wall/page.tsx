"use client";
import { useEffect, useMemo, useState } from "react";
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

export default function WallPage() {
  const [items, setItems] = useState<Creation[]>([]);
  const [filter, setFilter] = useState("review");
  const [scheduling, setScheduling] = useState<Creation | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();

  const load = () => api<Creation[]>("/api/creations").then(setItems).catch((e: Error) => push(e.message, "bad"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (c: Creation, status: string) => {
    await postJson("/api/creations", { id: c.id, status }, "PATCH");
    push(`${c.title || "Creation"} ${status}`, status === "approved" ? "ok" : "");
    load();
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
        <div className="tabs">{FILTERS.map((f) => <button key={f.key} type="button" className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>{f.label} ({items.filter(f.test).length})</button>)}</div>
      </div>

      {shown.length ? (
        <div className="grid-cards">
          {shown.map((c) => (
            <div key={c.id} className="card">
              <div className="thumb square" style={{ cursor: "zoom-in" }} onClick={() => setAt(shown.findIndex((x) => x.id === c.id))}><img src={fileUrl(c.file_id)} alt={c.title} /><span className="tag"><Pill tone={statusTone(c.status)}>{c.status}</Pill></span></div>
              <div className="body">
                <strong>{c.title || "Untitled"}</strong>
                <p>{c.mode === "gemini" ? c.model : c.mode} · {fmtDate(c.created_at)}</p>
                <p>{[c.competitor ? `from ${c.competitor}` : "", c.product_name ? `${c.product_name}${c.product_color ? ` ${c.product_color}` : ""}` : ""].filter(Boolean).join(" · ") || "No source recorded"}</p>
                {c.post_count ? <Pill tone="info">{c.post_count} post{c.post_count > 1 ? "s" : ""} planned</Pill> : null}
                <div className="row">
                  {c.status !== "approved" ? <button className="btn small primary" type="button" onClick={() => setStatus(c, "approved")}>Approve</button> : <button className="btn small primary" type="button" onClick={() => setScheduling(c)}>Schedule</button>}
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
