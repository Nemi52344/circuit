"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fileUrl, downloadUrl, fmtDay } from "@/lib/api";
import { Pill, Empty, ImageViewer, useToast } from "@/components/ui";
import { Tabs, Cell } from "@/components/Sheet";
import type { ViewerItem } from "@/components/ui";
import type { FileRow } from "@/lib/types";

/* The brand's own store of pictures and video.

   Circuit has always kept every file it touched, which is not the same as having a library:
   a thousand drafts and scraped references with the brand's real shots lost among them. What
   turns it into a store is being able to say which ones are ours, give them a name somebody
   chose, and put enough words on them to find them again in six months. */

const KINDS = [
  { key: "all", label: "Everything" },
  { key: "brand", label: "Ours" },
  { key: "video", label: "Video" },
  { key: "product", label: "Products" },
  { key: "generated", label: "Creations" },
  { key: "inspiration", label: "References" },
  { key: "upload", label: "Uploads" },
];

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const isImage = (f: FileRow) => f.mime.startsWith("image/");
const isVideo = (f: FileRow) => f.mime.startsWith("video/");

export default function LibraryPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<FileRow[]>("/api/files").then(setFiles).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  /* Uploading from here means "this is ours" — anywhere else in Circuit a file arrives as a
     by-product, but a file added to the library was added on purpose. */
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    fd.append("kind", "upload");
    fd.append("brand", "1");
    setBusy(true);
    try {
      await api("/api/files", { method: "POST", body: fd });
      push(`Added ${list.length} file${list.length > 1 ? "s" : ""} to the brand store`, "ok");
      load();
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api("/api/files", { method: "PATCH", body: JSON.stringify({ id, ...body }), headers: { "Content-Type": "application/json" } });
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };

  const remove = async (f: FileRow) => {
    if (!confirm(`Delete ${f.title || f.name}?`)) return;
    const r = await fetch(`/api/files/${f.id}`, { method: "DELETE" });
    if (!r.ok) { push("Something else is still using that file", "bad"); return; }
    load();
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return files.filter((f) => {
      const byKind = kind === "all" ? true
        : kind === "brand" ? f.brand === 1
        : kind === "video" ? isVideo(f)
        : f.kind === kind;
      if (!byKind) return false;
      if (!needle) return true;
      return `${f.title || ""} ${f.name} ${f.tags || ""} ${f.kind}`.toLowerCase().includes(needle);
    });
  }, [files, kind, q]);

  const pics = useMemo(() => shown.filter(isImage), [shown]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map((f) => ({
    id: f.id,
    src: fileUrl(f.id),
    title: f.title || f.name,
    subtitle: fmtDay(f.created_at),
    tags: [{ label: f.kind, tone: "info" }, ...(f.brand ? [{ label: "ours", tone: "ok" }] : [])],
    fields: [{ label: "Size", value: fmtSize(f.size) }, { label: "Type", value: f.mime }, ...(f.tags ? [{ label: "Tags", value: f.tags }] : [])],
  })), [pics]);

  const count = (k: string) => k === "all" ? files.length
    : k === "brand" ? files.filter((f) => f.brand === 1).length
    : k === "video" ? files.filter(isVideo).length
    : files.filter((f) => f.kind === k).length;

  const total = files.reduce((a, f) => a + f.size, 0);
  const videos = files.filter(isVideo).length;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Library</h2>
          <p className="lede">
            Every picture and video Circuit holds — {files.length} files, {fmtSize(total)}{videos ? `, ${videos} of them video` : ""}.
            Name them and tag them and they stay findable; mark the brand&apos;s own and they sit under <strong>Ours</strong>.
          </p>
        </div>
        <span className="actions">
          <input className="input" placeholder="Search name or tag…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minHeight: 38, width: 210 }} />
          <label className="btn primary">{busy ? "Uploading…" : "Add to the store"}<input type="file" accept="image/*,video/*" multiple hidden onChange={upload} disabled={busy} /></label>
        </span>
      </div>

      <Tabs tabs={KINDS.map((k) => ({ key: k.key, label: k.label, count: count(k.key) }))} active={kind} onPick={setKind} />

      {shown.length ? (
        <div className="grid-cards">
          {shown.map((f) => (
            <div key={f.id} className="card">
              <div className="thumb square" style={isImage(f) ? { cursor: "zoom-in" } : undefined}
                onClick={() => isImage(f) && setAt(pics.findIndex((x) => x.id === f.id))}>
                {isImage(f) ? <img src={fileUrl(f.id)} alt={f.title || f.name} />
                  : isVideo(f) ? <video className="asset-video" src={fileUrl(f.id)} preload="metadata" muted playsInline controls />
                  : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)" }}>{f.mime}</div>}
                <span className="tag">
                  {f.brand ? <Pill tone="ok">ours</Pill> : <Pill tone="info">{f.kind}</Pill>}
                </span>
              </div>
              <div className="body">
                <strong style={{ wordBreak: "break-word" }}>{f.title || f.name}</strong>
                <p>{fmtSize(f.size)} · {fmtDay(f.created_at)}{isVideo(f) ? " · video" : ""}</p>
                {f.tags ? <div className="asset-tagline">{f.tags.split(",").map((t) => <span className="tag-chip" key={t}>{t.trim()}</span>)}</div> : null}
                <div className="row">
                  {isImage(f) ? <button className="btn small" type="button" onClick={() => setAt(pics.findIndex((x) => x.id === f.id))}>View</button> : null}
                  <button className="btn small ghost" type="button" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Done" : "Name it"}</button>
                  <button className="btn small ghost" type="button" onClick={() => downloadUrl(fileUrl(f.id), f.name)}>Download</button>
                </div>
                {open === f.id ? (
                  <div className="stack" style={{ gap: 7, marginTop: 8 }}>
                    <label className="field"><span>Title</span><Cell value={f.title || ""} onSave={(v) => patch(f.id, { title: v })} placeholder={f.name} /></label>
                    <label className="field"><span>Tags</span><Cell value={f.tags || ""} onSave={(v) => patch(f.id, { tags: v })} placeholder="bike, studio, festive" /></label>
                    <label className="check" style={{ fontSize: 13 }}>
                      <input type="checkbox" checked={f.brand === 1} onChange={(e) => patch(f.id, { brand: e.target.checked })} />
                      <span>One of ours</span>
                    </label>
                    <div className="actions">
                      <button className="btn small danger" type="button" onClick={() => remove(f)}>Delete</button>
                      {f.kind !== "upload" ? <span className="muted small">also used by {f.kind === "product" ? "Studio" : f.kind === "inspiration" ? "Inspiration" : "the Wall"}</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={q ? `Nothing matching "${q}"` : "Nothing here yet"} hint={q ? "Try a shorter word, or clear the search." : "Files added anywhere in Circuit show up here. Add the brand's own with the button above."} />
      )}
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Library" /> : null}
    </div>
  );
}
