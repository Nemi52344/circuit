"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, postJson, fileUrl, downloadUrl, fmtDay } from "@/lib/api";
import { Empty, ImageViewer, useToast } from "@/components/ui";
import { Tabs, Cell } from "@/components/Sheet";
import type { ViewerItem } from "@/components/ui";
import type { FileRow } from "@/lib/types";
import { useMe } from "@/components/Gate";
import { can } from "@/lib/roles";

type Item = { file: File; path: string };
type Watch = { folder: string; exists: boolean; last: { at: string; added: number; already: number; errors: string[]; more?: boolean } | null };

/* Everything inside a dropped folder, with its path. Browsers hand over a dropped folder as an
   entry tree rather than a list of files, so it is walked here. */
async function entriesToItems(entries: FileSystemEntry[]): Promise<Item[]> {
  const out: Item[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file: f, path: e.fullPath.replace(/^\//, "") });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
const MEDIA = /\.(jpe?g|png|webp|gif|heic|heif|tiff?|mp4|mov|m4v|pdf|zip)$/i;

/* The raw collateral: our own photographs and video, straight from the shoot.

   This is the one store in Circuit that only a person fills. Everything else in the Library
   arrives as a by-product — scraped references, generated drafts, posters — and the real shots
   get lost among them. Here there is nothing but what somebody chose to add, so it can be
   trusted as the source for every post, brochure and ad. Circuit cannot add to it: it does not
   hold the camera. */

/* The product photographs (the studio renders on Products) are ours too, so they are shown here
   as well — still kept as product photos, so the Studio and the product pages go on using them. */
const RAW = "raw,product";
const isProduct = (f: FileRow) => f.kind === "product";
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const isImage = (f: FileRow) => f.mime.startsWith("image/");
const isVideo = (f: FileRow) => f.mime.startsWith("video/");

export default function ImagesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [show, setShow] = useState("all");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState("");
  const [at, setAt] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { push, view } = useToast();
  const { me } = useMe();
  const manager = can(me, "manage");
  const [prog, setProg] = useState<{ done: number; total: number; added: number; already: number; failed: string[]; current: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [folder, setFolder] = useState("");
  const loadWatch = useCallback(() => api<Watch>("/api/collateral").then((w) => { setWatch(w); setFolder(w.folder); }).catch(() => null), []);
  useEffect(() => { loadWatch(); }, [loadWatch]);

  /* Files go up one at a time, each with its place in the folder, so tags come from folder
     names and a shoot of big videos never has to fit in one request. */
  const importItems = async (items: Item[]) => {
    const list = items.filter((i) => MEDIA.test(i.file.name) && !i.file.name.startsWith("."));
    if (!list.length) return push("No photos, videos, PDFs or zips in that", "bad");
    const st = { done: 0, total: list.length, added: 0, already: 0, failed: [] as string[], current: "" };
    setProg({ ...st });
    for (const it of list) {
      st.current = it.path;
      setProg({ ...st });
      try {
        const r = await fetch(`/api/collateral?path=${encodeURIComponent(it.path)}&tags=${encodeURIComponent(tags.trim())}`, { method: "POST", body: it.file });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        st.added += j.added || 0; st.already += j.already || 0;
        if (j.errors?.length) st.failed.push(...j.errors);
      } catch (e) { st.failed.push(`${it.file.name}: ${(e as Error).message}`); }
      st.done++;
      setProg({ ...st });
    }
    st.current = "";
    setProg({ ...st });
    push(`Added ${st.added}${st.already ? ` · ${st.already} already here` : ""}${st.failed.length ? ` · ${st.failed.length} could not be read` : ""}`, st.failed.length ? "bad" : "ok");
    load();
  };
  const fromInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const items = Array.from(e.target.files || []).map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
    e.target.value = "";
    importItems(items);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const entries = Array.from(e.dataTransfer.items || []).map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => Boolean(x));
    importItems(entries.length ? await entriesToItems(entries) : Array.from(e.dataTransfer.files).map((f) => ({ file: f, path: f.name })));
  };
  const saveWatch = async () => {
    try { setWatch(await postJson<Watch>("/api/collateral", { action: "watch", folder }, "PATCH")); push(folder ? "Circuit will look in that folder every ten minutes" : "Stopped watching", "ok"); }
    catch (err) { push((err as Error).message, "bad"); }
  };
  const scanNow = async () => {
    try { const r = await postJson<Watch>("/api/collateral", { action: "scan" }, "PATCH"); setWatch(r); push(`Looked: ${r.last?.added || 0} new`, "ok"); load(); }
    catch (err) { push((err as Error).message, "bad"); }
  };

  const load = useCallback(() => api<FileRow[]>(`/api/files?kind=${RAW}`).then(setFiles).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

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
    return files.filter((f) => (show === "all" || (show === "product" ? isProduct(f) : show === "photo" ? isImage(f) : isVideo(f)))
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
  const products = files.filter(isProduct).length;
  const untagged = files.filter((f) => !(f.tags || "").trim()).length;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Our collateral</h2>
          <p className="lede">
            The raw collateral — our own photographs and video, straight from the shoot. Only a person adds to it, so
            everything here is ours and safe to use. {files.length} files, {fmtSize(files.reduce((a, f) => a + f.size, 0))}.
          </p>
        </div>
        <span className="actions">
          <input className="input" placeholder="Tags for this batch — e.g. Challenger, studio, Oct shoot" aria-label="Tags for the files you are about to add"
            value={tags} onChange={(e) => setTags(e.target.value)} style={{ minHeight: 38, width: 300 }} />
          <label className="btn">Add files
            <input type="file" accept="image/*,video/*,.heic,.pdf,.zip" multiple hidden onChange={fromInput} disabled={Boolean(prog && prog.done < prog.total)} />
          </label>
          <label className="btn primary">Add a folder
            {/* @ts-expect-error — webkitdirectory is real in every browser, just not in React's types */}
            <input type="file" webkitdirectory="" directory="" multiple hidden onChange={fromInput} disabled={Boolean(prog && prog.done < prog.total)} />
          </label>
        </span>
      </div>

      {/* Drop a folder, a zip from SharePoint or a handful of files anywhere in here. */}
      <div className={`col-drop ${drag ? "is-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <strong>Drop a folder, a zip or photos and videos here</strong>
        <span>From SharePoint: open the folder, press <b>Download</b>, and drop the zip. Folder names become tags; files already here are skipped; iPhone HEIC photos become JPG; PDFs go to Brochures.</span>
        {prog ? (
          <div className="col-prog" aria-live="polite">
            <div className="col-bar"><i style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} /></div>
            <span>{prog.done < prog.total ? `Bringing in ${prog.done + 1} of ${prog.total} — ${prog.current}` : `Done — ${prog.added} added`}{prog.already ? ` · ${prog.already} already here` : ""}{prog.failed.length ? ` · ${prog.failed.length} could not be read` : ""}</span>
            {prog.failed.length && prog.done === prog.total ? <details><summary className="small">Which ones</summary><ul className="small">{prog.failed.slice(0, 20).map((f) => <li key={f}>{f}</li>)}</ul></details> : null}
          </div>
        ) : null}
      </div>

      {manager ? (
        <details className="col-watch" open={Boolean(watch?.folder)}>
          <summary>Bring in new shoots automatically {watch?.exists ? <span className="col-led on" /> : null}</summary>
          <p className="small muted">Point Circuit at a folder on this computer — the OneDrive folder, once the OneDrive app syncs <b>Gowtham / Master</b> here. On a Mac it appears under <code>~/Library/CloudStorage/OneDrive-…</code>; on Windows under <code>%USERPROFILE%OneDrive - …</code>. Every ten minutes anything new in it is added; nothing in the folder is changed.</p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="The full path to the folder to watch" style={{ flex: 1, minWidth: 260, minHeight: 36 }} aria-label="Folder to watch" />
            <button type="button" className="btn small" onClick={saveWatch}>Save</button>
            {watch?.exists ? <button type="button" className="btn small ghost" onClick={scanNow}>Look now</button> : null}
          </div>
          {watch?.last ? <p className="small muted" style={{ margin: 0 }}>Last looked {fmtDay(watch.last.at)} — {watch.last.added} added, {watch.last.already} already here{watch.last.more ? " · still bringing in the rest" : ""}{watch.last.errors.length ? ` · ${watch.last.errors.length} could not be read` : ""}.</p> : null}
        </details>
      ) : null}

      <div className="grid-cards">
        <div className="kpi"><strong>{photos}</strong><small>photographs</small><span>raw, ours</span></div>
        <div className="kpi"><strong>{videos}</strong><small>videos</small><span>raw, ours</span></div>
        <div className={`kpi ${untagged ? "graphite" : "deep"}`}><strong>{untagged}</strong><small>without tags</small><span>{untagged ? "tag them so they can be found" : "every file findable"}</span></div>
      </div>

      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <Tabs tabs={[{ key: "all", label: "Everything", count: files.length }, { key: "photo", label: "Photos", count: photos }, { key: "product", label: "Product photos", count: products }, { key: "video", label: "Video", count: videos }]}
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
                <p>{isProduct(f) ? <span className="tag-chip">Product photo</span> : null} {fmtSize(f.size)} · added {fmtDay(f.created_at)}{isVideo(f) ? " · video" : ""}</p>
                {f.tags ? <div className="asset-tagline">{f.tags.split(",").filter((t) => t.trim()).map((t) => <span className="tag-chip" key={t}>{t.trim()}</span>)}</div> : null}
                <div className="row">
                  <button className="btn small ghost" type="button" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Done" : "Name and tag"}</button>
                  <button className="btn small ghost" type="button" onClick={() => downloadUrl(fileUrl(f.id), f.name)}>Download</button>
                </div>
                {open === f.id ? (
                  <div className="stack" style={{ gap: 7, marginTop: 8 }}>
                    <label className="field"><span>Title</span><Cell value={f.title || ""} onSave={(v) => patch(f.id, { title: v })} placeholder={f.name} /></label>
                    <label className="field"><span>Tags</span><Cell value={f.tags || ""} onSave={(v) => patch(f.id, { tags: v })} placeholder="model, place, shoot" /></label>
                    {isProduct(f)
                      ? <p className="small muted" style={{ margin: 0 }}>A product photo — the Studio uses it. Remove it from Products if it should go.</p>
                      : <div className="actions"><button className="btn small danger" type="button" onClick={() => remove(f)}>Delete</button></div>}
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
