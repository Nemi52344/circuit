"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fileUrl, downloadUrl, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, useToast } from "@/components/ui";

/* Brochures, spec sheets, price lists, dealer notes. Kept here so they are in one place and
   so agents can quote from them instead of guessing. A PDF keeps its file; its words can be
   pasted in beside it, because that is what an agent can actually read. */

type Doc = { id: string; title: string; kind: string; tags: string; notes: string; file_id: string | null; text_length: number; created_at: string };
const KINDS = ["brochure", "spec sheet", "price list", "policy", "note", "other"];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<Doc[]>("/api/documents").then(setDocs).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    fd.append("kind", "brochure");
    setBusy(true);
    try {
      await api("/api/documents", { method: "POST", body: fd });
      push(`Added ${list.length} file${list.length > 1 ? "s" : ""}`, "ok");
      load();
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const remove = async (d: Doc) => {
    if (!confirm(`Delete "${d.title}"?`)) return;
    await api(`/api/documents?id=${d.id}`, { method: "DELETE" });
    load();
  };

  if (!docs) return <p className="muted">Loading…</p>;
  const shown = docs.filter((d) => kind === "all" || d.kind === kind);

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Brochures</h2>
          <p className="lede">Your brochures, spec sheets and price lists in one place. Agents can quote from the ones whose words are in here.</p>
        </div>
        <span className="actions">
          <button className="btn" type="button" onClick={() => setEditing({ id: "", title: "", kind: "note", tags: "", notes: "", file_id: null, text_length: 0, created_at: "" })}>Write one</button>
          <label className="btn primary">{busy ? "Adding…" : "Add files"}<input type="file" multiple hidden onChange={upload} disabled={busy} /></label>
        </span>
      </div>

      <div className="tabs">
        <button type="button" className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>All ({docs.length})</button>
        {KINDS.map((k) => {
          const n = docs.filter((d) => d.kind === k).length;
          return n ? <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{k} ({n})</button> : null;
        })}
      </div>

      {shown.length ? (
        <div className="grid-cards">
          {shown.map((d) => (
            <div key={d.id} className="card">
              <div className="thumb square" style={{ display: "grid", placeItems: "center", padding: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <strong style={{ display: "block", fontSize: 13.5 }}>{d.title}</strong>
                  <span className="small muted">{d.kind}</span>
                </div>
                <span className="tag"><Pill tone={d.text_length ? "ok" : "warn"}>{d.text_length ? "agents can read it" : "words not added"}</Pill></span>
              </div>
              <div className="body">
                <strong>{d.title}</strong>
                <p>{d.tags || "No tags"} · {fmtDay(d.created_at)}</p>
                {d.notes ? <p>{d.notes.slice(0, 90)}</p> : null}
                <div className="row">
                  <button className="btn small primary" type="button" onClick={() => setEditing(d)}>Open</button>
                  <span className="actions">
                    {d.file_id ? <button className="btn small" type="button" onClick={() => downloadUrl(fileUrl(d.file_id as string), d.title)}>Download</button> : null}
                    <button className="btn small danger" type="button" onClick={() => remove(d)}>Delete</button>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="Nothing here yet" hint="Add your brochure and spec sheet PDFs, then paste their words in so agents can quote them." />
      )}

      {editing ? <DocEditor doc={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} push={push} /> : null}
    </div>
  );
}

function DocEditor({ doc, onClose, onSaved, push }: { doc: Doc; onClose: () => void; onSaved: () => void; push: (t: string, tone?: string) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState(doc.kind);
  const [tags, setTags] = useState(doc.tags);
  const [notes, setNotes] = useState(doc.notes);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!doc.id);

  useEffect(() => {
    if (!doc.id) return;
    api<{ text?: string }>(`/api/documents?id=${doc.id}`).then((r) => { setText(r.text || ""); setLoaded(true); }).catch(() => setLoaded(true));
  }, [doc.id]);

  const save = async () => {
    if (!title.trim()) return push("Give it a title", "bad");
    setBusy(true);
    try {
      await postJson("/api/documents", { id: doc.id || undefined, title, kind, tags, notes, text });
      push("Saved", "ok");
      onSaved();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={doc.id ? doc.title : "Write a document"} eyebrow="Brochures" onClose={onClose}>
      <div className="stack">
        <div className="form-grid">
          <label className="field"><span>Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span>What it is</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          </label>
          <label className="field full"><span>Tags</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="challenger, dealers, 2026" /></label>
          <label className="field full"><span>Note to yourself</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where this came from, who it is for" /></label>
        </div>
        <label className="field">
          <span>The words in it <em className="muted">agents read this, not the PDF</em></span>
          <textarea className="textarea" rows={12} value={loaded ? text : "Loading…"} onChange={(e) => setText(e.target.value)} placeholder="Paste the text of the brochure here. Select all in the PDF, copy, paste." />
        </label>
        {doc.file_id ? <p className="small muted" style={{ margin: 0 }}>The file itself is kept and can be downloaded. Circuit does not read inside PDFs yet, which is why the words are pasted here.</p> : null}
        <div className="actions">
          <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
