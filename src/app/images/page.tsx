"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fileUrl, downloadUrl, fmtDay } from "@/lib/api";
import { Empty, ImageViewer, useToast } from "@/components/ui";
import { Tabs, Cell } from "@/components/Sheet";
import type { ViewerItem } from "@/components/ui";
import type { FileRow } from "@/lib/types";

/* The raw collateral: our own photographs and video, straight from the shoot.

   This is the one store in Circuit that only a person fills. Everything else in the Library
   arrives as a by-product — scraped references, generated drafts, posters — and the real shots
   get lost among them. Here there is nothing but what somebody chose to add, so it can be
   trusted as the source for every post, brochure and ad. Circuit cannot add to it: it does not
   hold the camera. */

const RAW = "raw";
const OURS = "Ours, free to publish";
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const isImage = (f: FileRow) => f.mime.startsWith("image/");
const isVideo = (f: FileRow) => f.mime.startsWith("video/");

export default function ImagesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [show, setShow] = useState("all");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<FileRow[]>(`/api/files?kind=${RAW}`).then(setFiles).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    fd.append("kind", RAW);
    fd.append("brand", "1");
    fd.append("rights", OURS);
    if (tags.trim()) fd.append("tags", tags.trim());
    setBusy(true);
    try {
      const r = await api<{ files: FileRow[]; saved: number; already: string[] }>("/api/files", { method: "POST", body: fd });
      /* A shot already uploaded somewhere else as a plain upload is moved in here, because that
         is what it was all along. One that another part of Circuit is using stays where it is. */
      const plain = r.files.filter((f) => f.kind === "upload");
      for (const f of plain) {
        await api("/api/files", { method: "PATCH", body: JSON.stringify({ id: f.id, kind: RAW, brand: true, rights: f.rights || OURS }), headers: { "Content-Type": "application/json" } });
      }
      const elsewhere = r.files.filter((f) => f.kind !== RAW && f.kind !== "upload").length;
      push(`Added ${r.saved + plain.length}${elsewhere ? ` · ${elsewhere} already in the Library as something else, left there` : ""}`, "ok");
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
    if (!confirm(`Delete ${f.title || f.name}? This removes the file from Circuit.`)) return;
    const r = await fetch(`/api/files/${f.id}`, { method: "DELETE" });
    if (!r.ok) { push("A post or poster is still using that file", "bad"); return; }
    load();
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return files.filter((f) => (show === "all" || (show === "photo" ? isImage(f) : isVideo(f)))
      && (!needle || `${f.title || ""} ${f.name} ${f.tags || ""}`.toLowerCase().includes(needle)));
  }, [files, show, q]);

  const pics = useMemo(() => shown.filter(isImage), [shown]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map((f) => ({
    id: f.id, src: fileUrl(f.id), title: f.title || f.name, subtitle: fmtDay(f.created_at),
    tags: (f.tags || "").split(",").filter((t) => t.trim()).map((t) => ({ label: t.trim(), tone: "info" })),
    fields: [{ label: "Size", value: fmtSize(f.size) }, { label: "Type", value: f.mime }],
  })), [pics]);

  const photos = files.filter(isImage).length;
  const videos = files.filter(isVideo).length;
  const untagged = files.filter((f) => !(f.tags || "").trim()).length;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Image database</h2>
          <p className="lede">
            The raw collateral — our own photographs and video, straight from the shoot. Only a person adds to it, so
            everything here is ours and safe to use. {files.length} files, {fmtSize(files.reduce((a, f) => a + f.size, 0))}.
          </p>
        </div>
        <span className="actions">
          <input className="input" placeholder="Tags for this batch — e.g. Challenger, studio, Oct shoot" aria-label="Tags for the files you are about to add"
            value={tags} onChange={(e) => setTags(e.target.value)} style={{ minHeight: 38, width: 300 }} />
          <label className="btn primary">{busy ? "Uploading…" : "Add photos or video"}
            <input type="file" accept="image/*,video/*" multiple hidden onChange={upload} disabled={busy} />
          </label>
        </span>
      </div>

      <div className="grid-cards">
        <div className="kpi"><strong>{photos}</strong><small>photographs</small><span>raw, ours</span></div>
        <div className="kpi"><strong>{videos}</strong><small>videos</small><span>raw, ours</span></div>
        <div className={`kpi ${untagged ? "graphite" : "deep"}`}><strong>{untagged}</strong><small>without tags</small><span>{untagged ? "tag them so they can be found" : "every file findable"}</span></div>
      </div>

      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <Tabs tabs={[{ key: "all", label: "Everything", count: files.length }, { key: "photo", label: "Photos", count: photos }, { key: "video", label: "Video", count: videos }]}
          active={show} onPick={setShow} />
        <input className="input" placeholder="Search title or tag…" aria-label="Search the image database" value={q} onChange={(e) => setQ(e.target.value)} style={{ minHeight: 36, width: 220, marginLeft: "auto" }} />
      </div>

      {shown.length ? (
        <div className="grid-cards">
          {shown.map((f) => (
            <div key={f.id} className="card">
              <div className="thumb square" style={isImage(f) ? { cursor: "zoom-in" } : undefined}
                onClick={() => isImage(f) && setAt(pics.findIndex((x) => x.id === f.id))}>
                {isImage(f) ? <img src={fileUrl(f.id)} alt={f.title || f.name} loading="lazy" />
                  : <video className="asset-video" src={fileUrl(f.id)} preload="metadata" muted playsInline controls />}
              </div>
              <div className="body">
                <strong style={{ wordBreak: "break-word" }}>{f.title || f.name}</strong>
                <p>{fmtSize(f.size)} · added {fmtDay(f.created_at)}{isVideo(f) ? " · video" : ""}</p>
                {f.tags ? <div className="asset-tagline">{f.tags.split(",").filter((t) => t.trim()).map((t) => <span className="tag-chip" key={t}>{t.trim()}</span>)}</div> : null}
                <div className="row">
                  <button className="btn small ghost" type="button" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Done" : "Name and tag"}</button>
                  <button className="btn small ghost" type="button" onClick={() => downloadUrl(fileUrl(f.id), f.name)}>Download</button>
                </div>
                {open === f.id ? (
                  <div className="stack" style={{ gap: 7, marginTop: 8 }}>
                    <label className="field"><span>Title</span><Cell value={f.title || ""} onSave={(v) => patch(f.id, { title: v })} placeholder={f.name} /></label>
                    <label className="field"><span>Tags</span><Cell value={f.tags || ""} onSave={(v) => patch(f.id, { tags: v })} placeholder="model, place, shoot" /></label>
                    <div className="actions"><button className="btn small danger" type="button" onClick={() => remove(f)}>Delete</button></div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={q ? `Nothing matching "${q}"` : "No raw collateral yet"}
          hint={q ? "Try a shorter word, or clear the search." : "Add the photographs and video from a shoot with the button above. Tag the batch first and every file gets the tags."} />
      )}
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Image database" /> : null}
    </div>
  );
}
