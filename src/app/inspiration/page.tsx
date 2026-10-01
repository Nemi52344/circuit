"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, postJson, fileUrl, PLATFORMS, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, ImageViewer, useToast } from "@/components/ui";
import type { ViewerItem } from "@/components/ui";
import type { Inspiration } from "@/lib/types";

/* ---------- types shared with the API ---------- */
type Item = { key: string; title: string; image: string | null; link: string; source: string; competitor: string; format: string; notes: string; meta?: Record<string, string | number> };
type FetchResult = { items: Item[]; note: string };
type Watch = { id: string; kind: string; label: string; input: string };
type Competitor = { id: string; name: string; website: string; instagram: string; pinterest: string; folder: string; notes: string };
type FolderImage = { name: string; path: string; size: number; mtime: string; imported: boolean };
type FolderEntry = { name: string; path: string; images: FolderImage[] };
type FolderList = { root: string; exists: boolean; isDefault: boolean; folders: FolderEntry[]; total: number; imported: number };
type MetaAd = {
  id: string; page_id?: string; page_name?: string; ad_creation_time?: string; ad_delivery_start_time?: string; ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[]; ad_creative_link_titles?: string[]; ad_creative_link_descriptions?: string[];
  ad_snapshot_url?: string; publisher_platforms?: string[]; languages?: string[]; currency?: string; bylines?: string;
  spend?: { lower_bound?: string; upper_bound?: string }; impressions?: { lower_bound?: string; upper_bound?: string };
};
type AdResult = { ads: MetaAd[]; after: string; country: string };
type ImportResult = { created: { id: string; title: string }[]; skipped: string[]; errors: { title: string; error: string }[] };
type Push = (text: string, tone?: string) => void;

const FORMATS = ["Static post", "Carousel", "Story", "Reel cover", "Banner", "Print", "Other"];
const RIGHTS = "Third-party. Reference only, do not publish.";
const BOXES = [
  { key: "all", label: "All" },
  { key: "pinterest", label: "Pinterest" },
  { key: "ads", label: "Ads" },
  { key: "competitors", label: "Competitors" },
  { key: "instagram", label: "Their Instagram" },
  { key: "reddit", label: "Reddit" },
  { key: "folder", label: "Folder" },
] as const;
type BoxKey = (typeof BOXES)[number]["key"];

const adLibraryUrl = (name: string) => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=${encodeURIComponent(name)}&search_type=keyword_unordered&media_type=all`;
const igUrl = (h: string) => (h ? (h.startsWith("http") ? h : `https://www.instagram.com/${h.replace(/^@/, "")}/`) : "");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const summarise = (r: ImportResult) => {
  const bits = [`${r.created.length} saved`];
  if (r.skipped.length) bits.push(`${r.skipped.length} already there`);
  if (r.errors.length) bits.push(`${r.errors.length} failed: ${r.errors[0].error}`);
  return bits.join(" · ");
};

/* ---------- page ---------- */
export default function InspirationPage() {
  const { push, view } = useToast();
  const [items, setItems] = useState<Inspiration[]>([]);
  const [box, setBox] = useState<BoxKey>("all");
  const [q, setQ] = useState("");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [folders, setFolders] = useState<FolderList | null>(null);

  const load = useCallback(() => api<Inspiration[]>("/api/inspirations").then(setItems).catch((e: Error) => push(e.message, "bad")), [push]);
  const loadCompetitors = useCallback(() => api<Competitor[]>("/api/inspiration/competitors").then(setCompetitors).catch((e: Error) => push(e.message, "bad")), [push]);
  const loadFolders = useCallback(() => api<FolderList>("/api/inspiration/folders").then(setFolders).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => {
    load();
    loadCompetitors();
    loadFolders();
  }, [load, loadCompetitors, loadFolders]);

  const savedOrigins = useMemo(() => new Set(items.map((i) => i.origin || "").filter(Boolean)), [items]);
  const remove = async (id: string) => {
    if (!confirm("Delete this inspiration and its image?")) return;
    await api(`/api/inspirations?id=${id}`, { method: "DELETE" });
    load();
  };
  const importItems = async (list: Item[], overrides: Partial<Item> = {}) => {
    if (!list.length) return push("Nothing selected", "bad");
    try {
      const r = await postJson<ImportResult>("/api/inspiration/import", { items: list.map((i) => ({ ...i, ...overrides, rights: RIGHTS })) });
      push(summarise(r), r.errors.length && !r.created.length ? "bad" : "ok");
      await load();
      loadFolders();
      return r;
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };

  const counts: Record<BoxKey, number> = {
    all: items.length,
    pinterest: items.filter((i) => i.platform === "Pinterest").length,
    ads: items.filter((i) => i.platform === "Ads").length,
    competitors: competitors.length,
    instagram: competitors.filter((c) => c.instagram).length,
    reddit: items.filter((i) => i.platform === "Reddit").length,
    folder: folders?.total ?? 0,
  };
  const filtered = items.filter((i) => `${i.title} ${i.competitor} ${i.platform} ${i.format} ${i.notes}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Inspiration</h2>
          <p className="lede">Ads and ideas worth recreating. Save the ones you like, then create an image from them.</p>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search competitor, platform, notes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="tabs src-tabs">
        {BOXES.map((b) => (
          <button key={b.key} type="button" className={box === b.key ? "active" : ""} onClick={() => setBox(b.key)}>
            {b.label} ({counts[b.key]})
          </button>
        ))}
      </div>

      {box === "all" ? <AllBox items={filtered} q={q} onSaved={load} onDelete={remove} push={push} /> : null}
      {box === "pinterest" ? <PinterestBox items={filtered.filter((i) => i.platform === "Pinterest")} savedOrigins={savedOrigins} onImport={importItems} onDelete={remove} push={push} /> : null}
      {box === "ads" ? <AdsBox items={filtered.filter((i) => i.platform === "Ads")} competitors={competitors} onSaved={load} onDelete={remove} push={push} /> : null}
      {box === "competitors" ? <CompetitorsBox items={items} competitors={competitors} savedOrigins={savedOrigins} onImport={importItems} onSaved={load} onCompetitors={loadCompetitors} push={push} /> : null}
      {box === "instagram" ? <InstagramBox competitors={competitors} savedOrigins={savedOrigins} onSaved={load} push={push} /> : null}
      {box === "reddit" ? <RedditBox items={filtered.filter((i) => i.platform === "Reddit")} savedOrigins={savedOrigins} onImport={importItems} onDelete={remove} push={push} /> : null}
      {box === "folder" ? <FolderBox folders={folders} competitors={competitors} onRescan={loadFolders} onImport={importItems} push={push} /> : null}
    </div>
  );
}

/* Remote preview: try the CDN directly, fall back to the local proxy if it refuses hotlinking */
function Preview({ src, alt = "", style }: { src: string; alt?: string; style?: React.CSSProperties }) {
  const [url, setUrl] = useState(src);
  useEffect(() => setUrl(src), [src]);
  return <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" style={style} onError={() => { if (!url.startsWith("/api/")) setUrl(`/api/inspiration/preview?url=${encodeURIComponent(src)}`); }} />;
}

/* ---------- shared: library cards ---------- */
function LibraryGrid({ items, onDelete, emptyTitle, emptyHint }: { items: Inspiration[]; onDelete: (id: string) => void; emptyTitle: string; emptyHint: string }) {
  const [at, setAt] = useState<number | null>(null);
  const pics = useMemo(() => items.filter((i) => i.file_id), [items]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map((i) => ({
    id: i.id,
    src: fileUrl(i.file_id as string),
    title: i.title || "Saved inspiration",
    subtitle: `Saved ${fmtDay(i.created_at)}`,
    tags: [i.platform, i.competitor, i.format].filter(Boolean).map((t) => ({ label: t as string, tone: t === i.platform ? "info" : "" })),
    body: i.notes || "",
    links: i.source_url ? [{ label: "Where it came from", url: i.source_url }] : [],
    actions: <Link className="btn small primary" href={`/creation?ref=${i.id}`}>Make it ours</Link>,
  })), [pics]);
  if (!items.length) return <Empty title={emptyTitle} hint={emptyHint} />;
  return (
    <div className="grid-cards">
      {items.map((i) => (
        <div key={i.id} className={`card ${i.file_id ? "reveal" : ""}`}>
          <div className="thumb" onClick={() => i.file_id && setAt(pics.findIndex((x) => x.id === i.id))} style={i.file_id ? { cursor: "zoom-in" } : undefined}>
            {i.file_id ? (
              <img src={fileUrl(i.file_id)} alt={i.title} loading="lazy" />
            ) : (
              <div style={{ display: "grid", alignContent: "start", height: "100%", padding: 12, color: "var(--text-dim)", fontSize: 12.5, fontWeight: 300, lineHeight: 1.45, overflow: "hidden" }}>
                <strong style={{ color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>{i.title || "Idea"}</strong>
                {i.notes || "Link only"}
              </div>
            )}
            {i.platform ? <span className="tag"><Pill tone="info">{i.platform}</Pill></span> : null}
          </div>
          <div className="body" title={[i.title, i.notes, i.rights].filter(Boolean).join(" — ")}>
            <strong>{i.title || "Untitled"}</strong>
            <p>{[i.competitor, i.format].filter(Boolean).join(" · ") || "No tags"} · {fmtDay(i.created_at)}</p>
            {i.notes ? <p>{i.notes.slice(0, 120)}</p> : null}
            {!i.file_id && i.rights ? <span className="rights">{i.rights}</span> : null}
            <div className="row">
              {i.file_id ? <Link className="btn small primary" href={`/creation?ref=${i.id}`}>Recreate</Link> : <span className="pill">no image</span>}
              <span className="actions">
                {i.file_id ? <button className="btn small" type="button" onClick={() => setAt(pics.findIndex((x) => x.id === i.id))}>View</button> : null}
                {i.source_url ? <a className="btn small ghost" href={i.source_url} target="_blank" rel="noreferrer">Source</a> : null}
                <button className="btn small danger" type="button" onClick={() => onDelete(i.id)}>Delete</button>
              </span>
            </div>
          </div>
        </div>
      ))}
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Saved inspiration" /> : null}
    </div>
  );
}

/* ---------- shared: fetched results with selection ---------- */
function ResultsGrid({ items, savedOrigins, onImport, note, saving }: { items: Item[]; savedOrigins: Set<string>; onImport: (list: Item[]) => Promise<unknown>; note?: string; saving?: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [at, setAt] = useState<number | null>(null);
  const pics = useMemo(() => items.filter((i) => i.image), [items]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map((i) => ({
    id: i.key,
    src: i.image as string,
    title: i.title || "Untitled",
    subtitle: i.format || "",
    tags: [i.competitor, i.source].filter(Boolean).map((t) => ({ label: t as string, tone: "info" })),
    body: i.notes || "",
    links: [{ label: "Where it came from", url: i.link }],
  })), [pics]);
  const isSaved = (i: Item) => savedOrigins.has(i.image || i.link);
  const fresh = items.filter((i) => !isSaved(i));
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  useEffect(() => setSel(new Set()), [items]);
  if (!items.length) return note ? <div className="note">{note}</div> : null;
  return (
    <div className="stack">
      {note ? <div className="note small">{note}</div> : null}
      <div className="save-bar">
        <span className="count">{items.length} found · {fresh.length} new · {sel.size} selected</span>
        <button className="btn small" type="button" onClick={() => setSel(new Set(fresh.map((i) => i.key)))}>Select all new</button>
        <button className="btn small ghost" type="button" onClick={() => setSel(new Set())}>Clear</button>
        <button className="btn small primary" type="button" disabled={!sel.size || saving} onClick={() => onImport(items.filter((i) => sel.has(i.key))).then(() => setSel(new Set()))}>{saving ? "Saving…" : `Save selected (${sel.size})`}</button>
      </div>
      <div className="src-grid">
        {items.map((i) => {
          const done = isSaved(i);
          return (
            <div key={i.key} className={`src-card ${sel.has(i.key) ? "on" : ""} ${done ? "done" : ""}`} onClick={() => !done && toggle(i.key)} title={i.title}>
              {i.image ? (
                <div className="pic"><Preview src={i.image} /></div>
              ) : (
                <div className="pic text"><strong>{i.title}</strong>{i.notes || "No preview. Saves as a link."}</div>
              )}
              {!done ? <span className="tick">{sel.has(i.key) ? "✓" : ""}</span> : <span className="badge-done"><Pill tone="ok">saved</Pill></span>}
              <div className="meta">
                <strong>{i.title || "Untitled"}</strong>
                <span>{[i.competitor, i.format].filter(Boolean).join(" · ")}</span>
                <span className="meta-links">
                  {i.image ? <button type="button" onClick={(e) => { e.stopPropagation(); setAt(pics.findIndex((x) => x.key === i.key)); }}>View</button> : null}
                  <a href={i.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open ↗</a>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Found for you" /> : null}
    </div>
  );
}

function useFetcher(push: Push) {
  const [busy, setBusy] = useState(false);
  const run = async (kind: string, input: string): Promise<FetchResult | null> => {
    if (!input.trim()) { push("Paste a link first", "bad"); return null; }
    setBusy(true);
    try {
      return await postJson<FetchResult>("/api/inspiration/fetch", { kind, input });
    } catch (e) {
      push((e as Error).message, "bad");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/* ---------- box 1: All ---------- */
function AllBox({ items, q, onSaved, onDelete, push }: { items: Inspiration[]; q: string; onSaved: () => void; onDelete: (id: string) => void; push: Push }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [src, setSrc] = useState("All");
  const sources = ["All", ...Array.from(new Set(items.map((i) => i.platform).filter(Boolean)))];
  const shown = items.filter((i) => src === "All" || i.platform === src);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.delete("files");
    files.forEach((f) => fd.append("files", f));
    setBusy(true);
    try {
      const created = await api<Inspiration[]>("/api/inspirations", { method: "POST", body: fd });
      push(`Saved ${created.length} inspiration${created.length > 1 ? "s" : ""}`, "ok");
      formRef.current?.reset();
      setFiles([]);
      onSaved();
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="src-head">
        <div className="chips">
          <span className="chip-label">Source</span>
          {sources.map((s) => <button key={s} type="button" className={`chip ${src === s ? "on" : ""}`} onClick={() => setSrc(s)}>{s} ({s === "All" ? items.length : items.filter((i) => i.platform === s).length})</button>)}
        </div>
        <button className="btn small" type="button" onClick={() => setOpen(!open)}>{open ? "Hide manual add" : "Add by hand"}</button>
      </div>

      {open ? (
        <form ref={formRef} className="panel" onSubmit={submit}>
          <div className="panel-head"><h3>Add inspiration by hand</h3><span className="muted small">Screenshots, saved ads, anything. Reference only, never published.</span></div>
          <div className="form-grid">
            <label className="field full">
              <span>Images</span>
              <label className={`file-drop ${files.length ? "active" : ""}`}>
                <input type="file" name="files" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
                {files.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected: ${files.map((f) => f.name).join(", ")}` : "Click to choose one or more screenshots or ad images"}
              </label>
            </label>
            <label className="field"><span>Title</span><input className="input" name="title" placeholder="e.g. Ola monsoon banner" /></label>
            <label className="field"><span>Competitor</span><input className="input" name="competitor" placeholder="Ola, Ather, TVS, Bajaj…" /></label>
            <label className="field"><span>Platform</span><select className="select" name="platform" defaultValue=""><option value="">Choose</option>{[...PLATFORMS, "Pinterest", "Ads", "Reddit", "Website", "Folder"].map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className="field"><span>Format</span><select className="select" name="format" defaultValue=""><option value="">Choose</option>{FORMATS.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className="field"><span>Source link</span><input className="input" name="source_url" placeholder="https://instagram.com/p/…" /></label>
            <label className="field"><span>What to keep from it</span><input className="input" name="notes" placeholder="Low angle, wet road reflections, headline top-left" /></label>
            <input type="hidden" name="rights" value={RIGHTS} />
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save inspiration"}</button>
          </div>
        </form>
      ) : null}

      <LibraryGrid items={shown} onDelete={onDelete} emptyTitle={q ? "No match" : "No inspiration yet"} emptyHint="Attach a Pinterest moodboard, pull a competitor, or add a screenshot by hand." />
    </div>
  );
}

/* ---------- box 2: Pinterest moodboards ---------- */
function PinterestBox({ items, savedOrigins, onImport, onDelete, push }: { items: Inspiration[]; savedOrigins: Set<string>; onImport: (l: Item[], o?: Partial<Item>) => Promise<unknown>; onDelete: (id: string) => void; push: Push }) {
  const [watch, setWatch] = useState<Watch[]>([]);
  const [boards, setBoards] = useState<Record<string, { items: Item[]; note: string; loading: boolean }>>({});
  const [link, setLink] = useState("");
  const [pins, setPins] = useState("");
  const [pinResults, setPinResults] = useState<FetchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const { busy, run } = useFetcher(push);

  const fetchBoard = useCallback(async (w: Watch) => {
    setBoards((b) => ({ ...b, [w.id]: { items: b[w.id]?.items || [], note: "", loading: true } }));
    try {
      const r = await postJson<FetchResult>("/api/inspiration/fetch", { kind: "pinterest", input: w.input });
      setBoards((b) => ({ ...b, [w.id]: { ...r, loading: false } }));
    } catch (e) {
      setBoards((b) => ({ ...b, [w.id]: { items: [], note: (e as Error).message, loading: false } }));
    }
  }, []);
  const loadWatch = useCallback(async () => {
    const list = (await api<Watch[]>("/api/inspiration/watch")).filter((w) => w.kind === "pinterest");
    setWatch(list);
    for (const w of list) fetchBoard(w);
  }, [fetchBoard]);
  useEffect(() => { loadWatch().catch((e: Error) => push(e.message, "bad")); }, [loadWatch, push]);

  const addBoard = async () => {
    if (!link.trim()) return push("Paste a board or profile link", "bad");
    try {
      const list = await postJson<Watch[]>("/api/inspiration/watch", { kind: "pinterest", input: link.trim() });
      const mine = list.filter((w) => w.kind === "pinterest");
      setWatch(mine);
      setLink("");
      const added = mine.find((w) => w.input === link.trim());
      if (added) fetchBoard(added);
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };
  const removeBoard = async (w: Watch) => {
    const list = await api<Watch[]>(`/api/inspiration/watch?id=${w.id}`, { method: "DELETE" });
    setWatch(list.filter((x) => x.kind === "pinterest"));
  };
  const save = async (list: Item[]) => { setSaving(true); try { await onImport(list); } finally { setSaving(false); } };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head"><h3>Moodboards</h3><span className="muted small">Attach a Pinterest board or profile link. Every pin on it stays visible here; save the ones worth recreating.</span></div>
        <div className="fetch-row">
          <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.pinterest.com/<user>/<board>/  or  https://www.pinterest.com/<user>/" onKeyDown={(e) => e.key === "Enter" && addBoard()} />
          <button className="btn primary" type="button" onClick={addBoard}>Attach moodboard</button>
        </div>
        <div className="fetch-row">
          <textarea className="textarea" value={pins} onChange={(e) => setPins(e.target.value)} placeholder="Or paste single pin links (pinterest.com/pin/… or pin.it/…), one per line" rows={2} />
          <button className="btn" type="button" disabled={busy} onClick={async () => setPinResults(await run("pinterest", pins))}>{busy ? "Fetching…" : "Fetch pins"}</button>
        </div>
        {pinResults ? <ResultsGrid items={pinResults.items} savedOrigins={savedOrigins} onImport={save} note={pinResults.note} saving={saving} /> : null}
      </section>

      {watch.length ? watch.map((w) => {
        const b = boards[w.id];
        return (
          <section key={w.id} className="panel stack">
            <div className="panel-head">
              <h3>{w.label}</h3>
              <span className="actions">
                <span className="muted small">{b?.loading ? "loading…" : `${b?.items.length || 0} pins`}</span>
                <a className="btn small ghost" href={w.input.startsWith("http") ? w.input : `https://${w.input}`} target="_blank" rel="noreferrer">Open ↗</a>
                <button className="btn small" type="button" onClick={() => fetchBoard(w)} disabled={b?.loading}>Refresh</button>
                <button className="btn small danger" type="button" onClick={() => removeBoard(w)}>Detach</button>
              </span>
            </div>
            {b?.loading && !b.items.length ? <div className="progress"><span /></div> : null}
            {b && !b.loading && !b.items.length ? <div className="note bad">{b.note || "No pins came back for this link."}</div> : null}
            {b?.items.length ? <ResultsGrid items={b.items} savedOrigins={savedOrigins} onImport={(l) => save(l.map((i) => ({ ...i, competitor: i.competitor || w.label })))} note={b.note} saving={saving} /> : null}
          </section>
        );
      }) : (
        <Empty title="No moodboard attached" hint="Paste a Pinterest board link above. Pinterest search pages cannot be attached; boards and profiles can." />
      )}

      <div className="sec"><span className="t">Saved from Pinterest</span><span className="idx">[{String(items.length).padStart(3, "0")}]</span><span className="rule" /></div>
      <LibraryGrid items={items} onDelete={onDelete} emptyTitle="Nothing saved from Pinterest yet" emptyHint="Select pins above and save them." />
    </div>
  );
}

/* ---------- box 3: Ads (Meta Ad Library) ---------- */
const adFacts = (a: MetaAd) => {
  const range = (v?: { lower_bound?: string; upper_bound?: string }) => {
    if (!v) return "";
    const lo = v.lower_bound ? Number(v.lower_bound).toLocaleString("en-IN") : "";
    const hi = v.upper_bound ? Number(v.upper_bound).toLocaleString("en-IN") : "";
    return lo && hi ? `${lo}–${hi}` : lo ? `${lo}+` : hi ? `up to ${hi}` : "";
  };
  return { impressions: range(a.impressions), spend: range(a.spend) };
};
const adBody = (a: MetaAd) => [a.ad_creative_link_titles?.[0], a.ad_creative_bodies?.[0], a.ad_creative_link_descriptions?.[0]].filter(Boolean).join(" · ");

function AdsBox({ items, competitors, onSaved, onDelete, push }: { items: Inspiration[]; competitors: Competitor[]; onSaved: () => void; onDelete: (id: string) => void; push: Push }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [terms, setTerms] = useState("");
  const [country, setCountry] = useState("IN");
  const [activeOnly, setActiveOnly] = useState(true);
  const [result, setResult] = useState<AdResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [adLink, setAdLink] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  useEffect(() => { api<{ connected: boolean }>("/api/inspiration/ads").then((r) => setConnected(r.connected)).catch(() => setConnected(false)); }, []);

  const search = async (q = terms) => {
    if (!q.trim()) return push("Type a brand or keyword to search", "bad");
    setSearching(true);
    setSearchErr("");
    setCompetitor((c) => c || q.trim());
    try {
      setResult(await postJson<AdResult>("/api/inspiration/ads", { terms: q, country, activeOnly }));
    } catch (e) {
      setSearchErr((e as Error).message);
      setResult(null);
    } finally {
      setSearching(false);
    }
  };
  const saveAd = async (a: MetaAd) => {
    const f = adFacts(a);
    const fd = new FormData();
    fd.append("competitor", a.page_name || competitor);
    fd.append("platform", "Ads");
    fd.append("format", (a.publisher_platforms || []).join(", ") || "Meta ad");
    fd.append("source_url", a.ad_snapshot_url || adLibraryUrl(a.page_name || competitor));
    fd.append("title", (adBody(a) || `${a.page_name || "Ad"} ${a.id}`).slice(0, 120));
    fd.append("notes", [adBody(a), a.ad_delivery_start_time ? `live from ${a.ad_delivery_start_time.slice(0, 10)}` : "", f.impressions ? `impressions ${f.impressions}` : "", f.spend ? `spend ${f.spend} ${a.currency || ""}` : "", a.bylines ? `paid by ${a.bylines}` : ""].filter(Boolean).join(" · ").slice(0, 600));
    fd.append("rights", RIGHTS);
    try {
      await api("/api/inspirations", { method: "POST", body: fd });
      push(`Saved ad ${a.id} from ${a.page_name || competitor}`, "ok");
      onSaved();
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };

  const upload = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return push("No image in the clipboard or drop", "bad");
    const fd = new FormData();
    imgs.forEach((f, i) => fd.append("files", f, f.name && f.name !== "image.png" ? f.name : `${(competitor || "ad").replace(/\s+/g, "-").toLowerCase()}-ad-${Date.now()}-${i + 1}.png`));
    fd.append("competitor", competitor);
    fd.append("platform", "Ads");
    fd.append("format", "Meta ad");
    fd.append("source_url", adLink.trim() || (competitor ? adLibraryUrl(competitor) : ""));
    fd.append("notes", notes);
    fd.append("rights", RIGHTS);
    fd.append("title", competitor ? `${competitor} ad` : "Competitor ad");
    setBusy(true);
    try {
      const created = await api<Inspiration[]>("/api/inspirations", { method: "POST", body: fd });
      push(`Saved ${created.length} ad${created.length > 1 ? "s" : ""}${competitor ? ` for ${competitor}` : ""}`, "ok");
      setAdLink("");
      onSaved();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); upload(files); }
  };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setActive(false); upload(Array.from(e.dataTransfer.files || [])); };

  const savedAdIds = new Set(items.map((i) => (i.source_url.match(/[?&]id=(\d+)/) || [])[1]).filter(Boolean));
  const grouped = competitors.map((c) => ({ c, ads: items.filter((i) => same(i.competitor, c.name)) }));
  const others = items.filter((i) => !competitors.some((c) => same(c.name, i.competitor)));

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head">
          <h3>Meta Ad Library</h3>
          <span className="conn">
            {connected === null ? null : connected ? <Pill tone="ok">connected</Pill> : <Link className="pill warn" href="/settings">not connected · add a token</Link>}
          </span>
        </div>
        <div className="fetch-row">
          <input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Brand or keyword: Ola Electric, Ather, electric scooter…" onKeyDown={(e) => e.key === "Enter" && search()} />
          <span className="actions">
            <select className="select" style={{ width: 92 }} value={country} onChange={(e) => setCountry(e.target.value)} title="Country the ad reached">
              {["IN", "US", "GB", "DE", "FR", "AE", "SG", "AU"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn" type="button" onClick={() => setActiveOnly(!activeOnly)} title="Active ads only, or every ad on record">{activeOnly ? "Active only" : "All ads"}</button>
            <button className="btn primary" type="button" disabled={searching} onClick={() => search()}>{searching ? "Searching…" : "Search ads"}</button>
          </span>
        </div>
        <div className="chips">
          <span className="chip-label">Quick search</span>
          {competitors.map((c) => <button key={c.id} type="button" className="chip" onClick={() => { setTerms(c.name); setCompetitor(c.name); search(c.name); }}>{c.name}</button>)}
          <button type="button" className="chip" onClick={() => { setTerms("electric scooter"); search("electric scooter"); }}>electric scooter</button>
        </div>
        {searching ? <div className="progress"><span /></div> : null}
        {searchErr ? (
          <div className="note bad">
            <strong>{searchErr.startsWith("needs_meta_token") ? "No Meta token connected" : "Ad Library search failed"}</strong>
            {searchErr.startsWith("needs_meta_token")
              ? <>Add a Meta access token in <Link href="/settings" style={{ textDecoration: "underline" }}>Settings</Link>. Without it, browse the library below and paste screenshots instead.</>
              : searchErr}
          </div>
        ) : null}
        {result ? (
          <div className="stack">
            <div className="eyebrow" style={{ marginBottom: 0 }}>{result.ads.length} ads · reached {result.country} · {activeOnly ? "active" : "all"}</div>
            {result.ads.length ? result.ads.map((a) => {
              const f = adFacts(a);
              const done = savedAdIds.has(a.id);
              return (
                <div key={a.id} className={`ad-row ${done ? "done" : ""}`}>
                  <div>
                    <div className="who">{a.page_name || "Unknown page"}{a.bylines ? ` · paid by ${a.bylines}` : ""}</div>
                    <strong>{adBody(a) || `Ad ${a.id}`}</strong>
                    <div className="facts">
                      {(a.publisher_platforms || []).map((pl) => <Pill key={pl}>{pl}</Pill>)}
                      {a.ad_delivery_start_time ? <Pill tone="info">from {a.ad_delivery_start_time.slice(0, 10)}</Pill> : null}
                      {a.ad_delivery_stop_time ? <Pill tone="info">to {a.ad_delivery_stop_time.slice(0, 10)}</Pill> : null}
                      {f.impressions ? <Pill tone="info">{f.impressions} impressions</Pill> : null}
                      {f.spend ? <Pill tone="info">{f.spend} {a.currency || ""}</Pill> : null}
                    </div>
                  </div>
                  <div className="side">
                    {a.ad_snapshot_url ? <a className="btn small" href={a.ad_snapshot_url} target="_blank" rel="noreferrer">See creative ↗</a> : null}
                    {done ? <Pill tone="ok">saved</Pill> : <button className="btn small primary" type="button" onClick={() => saveAd(a)}>Save ad</button>}
                  </div>
                </div>
              );
            }) : <Empty title="No ads came back" hint="Meta returns commercial ads only where its rules allow. Try another country, switch to All ads, or browse and paste below." />}
            <div className="note small">Meta&apos;s API returns the ad&apos;s text and delivery facts, not its image. Open <strong>See creative</strong> to view the ad, then paste the screenshot below to keep the visual.</div>
          </div>
        ) : null}
      </section>

      <section className="panel stack">
        <div className="panel-head"><h3>Capture the creative</h3><span className="muted small">Screenshot an ad and paste it here with ⌘V. It is filed under the competitor with the library link and date.</span></div>
        <div className="chips">
          <span className="chip-label">Browse in Ad Library</span>
          {competitors.map((c) => <a key={c.id} className="chip" href={adLibraryUrl(c.name)} target="_blank" rel="noreferrer" onClick={() => setCompetitor(c.name)}>{c.name} ↗</a>)}
          <a className="chip" href={adLibraryUrl("electric motorcycle")} target="_blank" rel="noreferrer">electric motorcycle ↗</a>
        </div>
        <div className="form-grid">
          <label className="field"><span>Competitor</span>
            <input className="input" list="competitor-names" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Who ran the ad" />
            <datalist id="competitor-names">{competitors.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </label>
          <label className="field"><span>Ad Library link <em>optional</em></span><input className="input" value={adLink} onChange={(e) => setAdLink(e.target.value)} placeholder="https://www.facebook.com/ads/library/?id=…" /></label>
          <label className="field full"><span>What to keep from it</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Offer framing, price anchor, CTA wording" /></label>
        </div>
        <div
          ref={zone}
          tabIndex={0}
          className={`paste-zone ${active ? "active" : ""}`}
          onPaste={onPaste}
          onDragOver={(e) => { e.preventDefault(); setActive(true); }}
          onDragLeave={() => setActive(false)}
          onDrop={onDrop}
          onClick={() => zone.current?.querySelector("input")?.click()}
        >
          <strong>{busy ? "Saving…" : "Paste or drop ad screenshots"}</strong>
          Click here, then press ⌘V with a screenshot in the clipboard. Or drop image files. Each becomes an ad reference tagged {competitor || "with the competitor above"}.
          <input type="file" accept="image/*" multiple onChange={(e) => { upload(Array.from(e.target.files || [])); e.target.value = ""; }} />
        </div>
      </section>

      {grouped.filter((g) => g.ads.length).map((g) => (
        <section key={g.c.id} className="stack">
          <div className="sec"><span className="t">{g.c.name}</span><span className="idx">[{String(g.ads.length).padStart(3, "0")}]</span><span className="rule" /><a className="btn small ghost" href={adLibraryUrl(g.c.name)} target="_blank" rel="noreferrer">Ad Library ↗</a></div>
          <LibraryGrid items={g.ads} onDelete={onDelete} emptyTitle="" emptyHint="" />
        </section>
      ))}
      {others.length ? (
        <section className="stack">
          <div className="sec"><span className="t">Other ads</span><span className="idx">[{String(others.length).padStart(3, "0")}]</span><span className="rule" /></div>
          <LibraryGrid items={others} onDelete={onDelete} emptyTitle="" emptyHint="" />
        </section>
      ) : null}
      {!items.length ? <Empty title="No ads saved yet" hint="Search the library above with a token, or browse it and paste a screenshot." /> : null}
    </div>
  );
}

/* ---------- box 4: Competitors, last seven posts each ---------- */
function CompetitorsBox({ items, competitors, savedOrigins, onImport, onSaved, onCompetitors, push }: {
  items: Inspiration[]; competitors: Competitor[]; savedOrigins: Set<string>;
  onImport: (l: Item[], o?: Partial<Item>) => Promise<unknown>; onSaved: () => void; onCompetitors: () => void; push: Push;
}) {
  const [folders, setFolders] = useState<FolderList | null>(null);
  const [editing, setEditing] = useState<Partial<Competitor> | null>(null);
  const [results, setResults] = useState<Record<string, FetchResult>>({});
  const [pulling, setPulling] = useState<string>("");
  const [posting, setPosting] = useState<Competitor | null>(null);
  const [saving, setSaving] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const pics = useMemo(() => items.filter((i) => i.file_id), [items]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map((i) => ({
    id: i.id,
    src: fileUrl(i.file_id as string),
    title: i.title || "Saved post",
    subtitle: `Saved ${fmtDay(i.created_at)}`,
    tags: [i.competitor, i.platform, i.format].filter(Boolean).map((t) => ({ label: t as string, tone: t === i.competitor ? "info" : "" })),
    body: i.notes || "",
    links: i.source_url ? [{ label: "Where it came from", url: i.source_url }] : [],
    actions: <Link className="btn small primary" href={`/creation?ref=${i.id}`}>Make it ours</Link>,
  })), [pics]);

  const loadFolders = useCallback(() => api<FolderList>("/api/inspiration/folders").then(setFolders).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  const folderFor = (c: Competitor) => folders?.folders.find((f) => same(f.name, c.folder || c.name));
  const pullSite = async (c: Competitor) => {
    if (!c.website) return push("Add the website first (Edit)", "bad");
    setPulling(c.id);
    try {
      const r = await postJson<FetchResult>("/api/inspiration/fetch", { kind: "website", input: c.website });
      setResults((x) => ({ ...x, [c.id]: { ...r, items: r.items.map((i) => ({ ...i, competitor: c.name })) } }));
      if (!r.items.length) push(r.note || "No images found", "bad");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setPulling("");
    }
  };
  const importFolder = async (c: Competitor) => {
    const f = folderFor(c);
    const fresh = (f?.images || []).filter((i) => !i.imported);
    if (!fresh.length) return push("No new images in that folder", "bad");
    setSaving(true);
    try {
      await onImport(fresh.map((i) => ({ key: i.path, title: i.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), image: null, link: "", source: "Folder", competitor: c.name, format: "Own capture", notes: "" })).map((i) => ({ ...i, path: i.key })) as Item[]);
      loadFolders();
    } finally {
      setSaving(false);
    }
  };
  const save = async (l: Item[]) => { setSaving(true); try { await onImport(l); } finally { setSaving(false); } };
  const saveCompetitor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(["id", "name", "website", "instagram", "pinterest", "folder", "notes"].map((k) => [k, String(fd.get(k) || "")]));
    try {
      await postJson("/api/inspiration/competitors", body);
      push("Competitor saved", "ok");
      setEditing(null);
      onCompetitors();
      loadFolders();
    } catch (err) {
      push((err as Error).message, "bad");
    }
  };
  const removeCompetitor = async (c: Competitor) => {
    if (!confirm(`Remove ${c.name} from the list? Saved inspiration stays.`)) return;
    await api(`/api/inspiration/competitors?id=${c.id}`, { method: "DELETE" });
    onCompetitors();
  };

  return (
    <div className="stack">
      <div className="note small">Company images live in the <strong>Folder</strong> box. Import here files any new image in that company&apos;s folder as a reference.</div>

      {competitors.map((c) => {
        const mine = items.filter((i) => same(i.competitor, c.name)).slice(0, 7);
        const f = folderFor(c);
        const fresh = (f?.images || []).filter((i) => !i.imported).length;
        const res = results[c.id];
        return (
          <section key={c.id} className="panel stack">
            <div className="comp-head">
              <h3>{c.name}</h3>
              <span className="links">
                {c.website ? <a className="chip" href={c.website} target="_blank" rel="noreferrer">Site ↗</a> : null}
                {c.instagram ? <a className="chip" href={igUrl(c.instagram)} target="_blank" rel="noreferrer">@{c.instagram.replace(/^@/, "")} ↗</a> : null}
                {c.pinterest ? <a className="chip" href={c.pinterest.startsWith("http") ? c.pinterest : `https://www.pinterest.com/${c.pinterest}/`} target="_blank" rel="noreferrer">Pinterest ↗</a> : null}
                <a className="chip" href={adLibraryUrl(c.name)} target="_blank" rel="noreferrer">Ads ↗</a>
              </span>
              <span className="actions">
                <button className="btn small primary" type="button" disabled={pulling === c.id} onClick={() => pullSite(c)}>{pulling === c.id ? "Pulling…" : "Pull website"}</button>
                <button className="btn small" type="button" disabled={!fresh || saving} onClick={() => importFolder(c)}>Import folder ({fresh} new)</button>
                <button className="btn small" type="button" onClick={() => setPosting(c)}>Add Instagram posts</button>
                <button className="btn small ghost" type="button" onClick={() => setEditing(c)}>Edit</button>
                <button className="btn small danger" type="button" onClick={() => removeCompetitor(c)}>Remove</button>
              </span>
            </div>
            <div className="eyebrow" style={{ marginBottom: 0 }}>Last 7 posts</div>
            <div className="last7">
              {mine.map((i) => (
                i.file_id ? (
                  <button key={i.id} type="button" onClick={() => setAt(pics.findIndex((x) => x.id === i.id))} title={`${i.title} · ${fmtDay(i.created_at)}`}>
                    <img src={fileUrl(i.file_id)} alt={i.title} loading="lazy" /><span className="src">{i.platform || "saved"} · {fmtDay(i.created_at)}</span>
                  </button>
                ) : (
                  <a key={i.id} href={i.source_url} target="_blank" rel="noreferrer" title={i.title}>{i.title.slice(0, 60)}</a>
                )
              ))}
              {Array.from({ length: Math.max(0, 7 - mine.length) }).map((_, k) => <div key={k} className="slot">{k === 0 && !mine.length ? "nothing yet" : ""}</div>)}
            </div>
            {c.notes ? <p className="small muted">{c.notes}</p> : null}
            {res ? <ResultsGrid items={res.items} savedOrigins={savedOrigins} onImport={save} note={res.note} saving={saving} /> : null}
          </section>
        );
      })}

      <div className="actions"><button className="btn primary" type="button" onClick={() => setEditing({})}>Add competitor</button></div>

      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Saved from competitors" /> : null}
      {editing ? (
        <Modal title={editing.id ? `Edit ${editing.name}` : "Add a competitor"} eyebrow="Competitors" onClose={() => setEditing(null)}>
          <form onSubmit={saveCompetitor} className="stack">
            <input type="hidden" name="id" value={editing.id || ""} />
            <div className="form-grid">
              <label className="field"><span>Name</span><input className="input" name="name" defaultValue={editing.name || ""} required placeholder="Ather" /></label>
              <label className="field"><span>Folder name <em>under the root</em></span><input className="input" name="folder" defaultValue={editing.folder || ""} placeholder="defaults to the name" /></label>
              <label className="field"><span>Website</span><input className="input" name="website" defaultValue={editing.website || ""} placeholder="https://www.atherenergy.com/" /></label>
              <label className="field"><span>Instagram handle</span><input className="input" name="instagram" defaultValue={editing.instagram || ""} placeholder="atherenergy" /></label>
              <label className="field"><span>Pinterest profile or board</span><input className="input" name="pinterest" defaultValue={editing.pinterest || ""} placeholder="https://www.pinterest.com/…" /></label>
              <label className="field"><span>Notes</span><input className="input" name="notes" defaultValue={editing.notes || ""} /></label>
            </div>
            <div className="actions"><button className="btn primary" type="submit">Save</button><button className="btn ghost" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
          </form>
        </Modal>
      ) : null}

      {posting ? <InstagramPosts competitor={posting} onClose={() => setPosting(null)} onSaved={onSaved} onImport={onImport} push={push} /> : null}
    </div>
  );
}

/* Instagram posts for a competitor: links plus the images you saved from them */
function InstagramPosts({ competitor, onClose, onSaved, onImport, push }: { competitor: Competitor; onClose: () => void; onSaved: () => void; onImport: (l: Item[]) => Promise<unknown>; push: Push }) {
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const urls = links.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length && !files.length) return push("Paste post links or add images", "bad");
    setBusy(true);
    try {
      let previews: Item[] = [];
      if (urls.length) previews = (await postJson<FetchResult>("/api/inspiration/fetch", { kind: "instagram", input: urls.join("\n") })).items;
      const n = Math.max(urls.length, files.length);
      let saved = 0;
      const withPreview: Item[] = [];
      for (let i = 0; i < n; i++) {
        const link = urls[i] || "";
        const file = files[i];
        const pv = previews.find((p) => link && p.link.includes((link.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/) || [])[1] || "∅"));
        if (file) {
          const fd = new FormData();
          fd.append("files", file);
          fd.append("competitor", competitor.name);
          fd.append("platform", "Instagram");
          fd.append("format", link.includes("/reel") ? "Reel" : "Post");
          fd.append("source_url", pv?.link || link);
          fd.append("title", pv?.title || `${competitor.name} Instagram post`);
          fd.append("notes", pv?.notes || "");
          fd.append("rights", RIGHTS);
          await api("/api/inspirations", { method: "POST", body: fd });
          saved += 1;
        } else if (pv) {
          withPreview.push({ ...pv, competitor: competitor.name });
        }
      }
      if (withPreview.length) await onImport(withPreview);
      if (saved) push(`Saved ${saved} post${saved > 1 ? "s" : ""} for ${competitor.name}`, "ok");
      onSaved();
      onClose();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${competitor.name}: latest Instagram posts`} eyebrow="Competitors · Instagram" onClose={onClose}>
      <div className="stack">
        <div className="note small">Instagram only serves posts to a signed-in browser, so Circuit records the links and takes the images from you. Open {competitor.instagram ? <a href={igUrl(competitor.instagram)} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>@{competitor.instagram}</a> : "the profile"}, save the last posts (or screenshot them), then add them here in the same order as the links.</div>
        <label className="field"><span>Post links, one per line</span><textarea className="textarea" rows={4} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={"https://www.instagram.com/p/…\nhttps://www.instagram.com/reel/…"} /></label>
        <label className="field"><span>Images in the same order</span>
          <label className={`file-drop ${files.length ? "active" : ""}`}>
            <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            {files.length ? `${files.length} selected: ${files.map((f) => f.name).join(", ")}` : "Click to choose the saved post images"}
          </label>
        </label>
        <div className="actions"><button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save posts"}</button><button className="btn ghost" type="button" onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  );
}


/* ---------- box 6: Root folder, one subfolder per company ---------- */
function FolderBox({ folders, competitors, onRescan, onImport, push }: {
  folders: FolderList | null; competitors: Competitor[]; onRescan: () => void;
  onImport: (l: Item[], o?: Partial<Item>) => Promise<unknown>; push: Push;
}) {
  const [root, setRoot] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => { if (folders) setRoot(folders.root); }, [folders]);
  const pics = useMemo(() => (folders?.folders || []).flatMap((f) => (showDone ? f.images : f.images.filter((i) => !i.imported)).map((i) => ({ folder: f.name, img: i }))), [folders, showDone]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map(({ folder, img }) => ({
    id: img.path,
    src: `/api/inspiration/folders/file?path=${encodeURIComponent(img.path)}`,
    title: img.name,
    subtitle: folder,
    tags: img.imported ? [{ label: "already imported", tone: "ok" }] : [],
    fields: [{ label: "Size", value: `${Math.round(img.size / 1024)} KB` }, { label: "On this Mac", value: img.path }],
  })), [pics]);

  const setRootPath = async (value: string | null) => {
    try {
      await postJson("/api/inspiration/folders", { root: value });
      push(value ? "Root folder set" : "Back to the default folder", "ok");
      setSel(new Set());
      onRescan();
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };
  const toggle = (path: string) => setSel((x) => { const n = new Set(x); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const competitorFor = (folderName: string) => competitors.find((c) => same(c.folder || c.name, folderName))?.name || (folderName === "(root)" ? "" : folderName);

  const importPaths = async (imgs: FolderImage[], folderName: string) => {
    const fresh = imgs.filter((i) => !i.imported);
    if (!fresh.length) return push("Nothing new to import there", "bad");
    setBusy(true);
    try {
      await onImport(fresh.map((i) => ({
        key: i.path, path: i.path, title: i.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
        image: null, link: "", source: "Folder", competitor: competitorFor(folderName), format: "Own capture", notes: "",
      })) as Item[]);
      setSel(new Set());
    } finally {
      setBusy(false);
    }
  };
  const importSelected = async () => {
    const chosen: { img: FolderImage; folder: string }[] = [];
    for (const f of folders?.folders || []) for (const i of f.images) if (sel.has(i.path) && !i.imported) chosen.push({ img: i, folder: f.name });
    if (!chosen.length) return push("Nothing selected", "bad");
    setBusy(true);
    try {
      await onImport(chosen.map(({ img, folder }) => ({
        key: img.path, path: img.path, title: img.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
        image: null, link: "", source: "Folder", competitor: competitorFor(folder), format: "Own capture", notes: "",
      })) as Item[]);
      setSel(new Set());
    } finally {
      setBusy(false);
    }
  };

  const allFresh = (folders?.folders || []).flatMap((f) => f.images.filter((i) => !i.imported));

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head"><h3>Root folder</h3><span className="muted small">One subfolder per company. Drop their photos and posts in; every image here stays visible in this box.</span></div>
        <div className="folder-bar">
          <input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/Users/you/Pictures/competitors" onKeyDown={(e) => e.key === "Enter" && setRootPath(root)} />
          <button className="btn" type="button" onClick={() => setRootPath(root)}>Use this folder</button>
          <button className="btn ghost" type="button" onClick={() => setRootPath(null)}>Default</button>
          <button className="btn ghost" type="button" onClick={onRescan}>Rescan</button>
        </div>
        {folders ? (
          <div className="fstat">
            <span><b>{folders.folders.length}</b> folders</span>
            <span><b>{folders.total}</b> images</span>
            <span><b>{folders.imported}</b> imported</span>
            <span><b>{allFresh.length}</b> new</span>
            {!folders.exists ? <span style={{ color: "var(--ink)" }}>folder not found</span> : null}
          </div>
        ) : <div className="progress"><span /></div>}
        {folders?.exists && !folders.total ? (
          <div className="note">
            <strong>No images yet</strong>
            Put each company&apos;s photos in its own subfolder under <code>{folders.root}</code>, then press Rescan. Folder names become the competitor on every image imported from them.
          </div>
        ) : null}
      </section>

      {folders && folders.total ? (
        <div className="save-bar">
          <span className="count">{sel.size} selected · {allFresh.length} new across {folders.folders.filter((f) => f.images.length).length} folders</span>
          <button className="btn small" type="button" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide imported" : "Show imported"}</button>
          <button className="btn small" type="button" onClick={() => setSel(new Set(allFresh.map((i) => i.path)))}>Select all new</button>
          <button className="btn small ghost" type="button" onClick={() => setSel(new Set())}>Clear</button>
          <button className="btn small primary" type="button" disabled={!sel.size || busy} onClick={importSelected}>{busy ? "Importing…" : `Import selected (${sel.size})`}</button>
        </div>
      ) : null}

      {(folders?.folders || []).filter((f) => f.images.length).map((f) => {
        const shown = showDone ? f.images : f.images.filter((i) => !i.imported);
        const fresh = f.images.filter((i) => !i.imported).length;
        return (
          <section key={f.path} className="folder-card">
            <div className="head">
              <strong>{f.name}</strong>
              <span className="path">{f.path}</span>
              <Pill tone={fresh ? "warn" : "ok"}>{f.images.length} images · {fresh} new</Pill>
              <span className="actions">
                <button className="btn small" type="button" onClick={() => setSel(new Set([...sel, ...f.images.filter((i) => !i.imported).map((i) => i.path)]))} disabled={!fresh}>Select folder</button>
                <button className="btn small primary" type="button" disabled={!fresh || busy} onClick={() => importPaths(f.images, f.name)}>Import all new</button>
              </span>
            </div>
            <div className="body">
              <div className="fgrid">
                {shown.map((i) => (
                  <div key={i.path} className={`fitem ${sel.has(i.path) ? "on" : ""} ${i.imported ? "done" : ""}`} title={`${i.name} · ${Math.round(i.size / 1024)} KB`} onClick={() => !i.imported && toggle(i.path)}>
                    <img src={`/api/inspiration/folders/file?path=${encodeURIComponent(i.path)}`} alt={i.name} loading="lazy" />
                    {i.imported ? <span className="done-tag"><Pill tone="ok">in</Pill></span> : <span className="tick">{sel.has(i.path) ? "✓" : ""}</span>}
                    <button className="view-btn" type="button" onClick={(e) => { e.stopPropagation(); setAt(pics.findIndex((x) => x.img.path === i.path)); }}>View</button>
                    <span className="cap">{i.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {folders?.exists && folders.total > 0 && !folders.folders.some((f) => f.images.length) ? <Empty title="Nothing to show" hint="Every image here is imported already." /> : null}
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="Your folder" /> : null}
    </div>
  );
}

/* ---------- box 5: Reddit ideas ---------- */
function RedditBox({ items, savedOrigins, onImport, onDelete, push }: { items: Inspiration[]; savedOrigins: Set<string>; onImport: (l: Item[]) => Promise<unknown>; onDelete: (id: string) => void; push: Push }) {
  const [watch, setWatch] = useState<Watch[]>([]);
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<FetchResult | null>(null);
  const [current, setCurrent] = useState("");
  const [saving, setSaving] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const { busy, run } = useFetcher(push);
  const pics = useMemo(() => (result?.items || []).filter((i) => i.image), [result]);
  const viewItems = useMemo<ViewerItem[]>(() => pics.map((i) => ({
    id: i.key,
    src: i.image as string,
    title: i.title,
    subtitle: i.competitor || "Reddit",
    tags: [{ label: i.format || "Thread" }],
    body: i.notes || "",
    links: [{ label: "Read the thread", url: i.link }],
  })), [pics]);

  const loadWatch = useCallback(() => api<Watch[]>("/api/inspiration/watch").then((l) => setWatch(l.filter((w) => w.kind === "reddit"))).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { loadWatch(); }, [loadWatch]);

  const pull = async (sub: string, kw = keyword) => {
    const q = [sub, kw].filter(Boolean).join(" ");
    setCurrent(q);
    const r = await run("reddit", q);
    if (r) setResult(r);
  };
  const addWatch = async () => {
    const v = input.trim();
    if (!v) return push("Type a subreddit like r/electricvehicles", "bad");
    try {
      const l = await postJson<Watch[]>("/api/inspiration/watch", { kind: "reddit", input: v.startsWith("r/") || v.includes("reddit.com") ? v : `r/${v}` });
      setWatch(l.filter((w) => w.kind === "reddit"));
      setInput("");
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };
  const removeWatch = async (w: Watch) => {
    const l = await api<Watch[]>(`/api/inspiration/watch?id=${w.id}`, { method: "DELETE" });
    setWatch(l.filter((x) => x.kind === "reddit"));
  };
  const saveOne = async (i: Item) => { setSaving(true); try { await onImport([i]); } finally { setSaving(false); } };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head"><h3>Post ideas from Reddit</h3><span className="muted small">Top posts this week from the subreddits you watch. Save an idea as a text reference, or the image when the post has one.</span></div>
        <div className="chips">
          <span className="chip-label">Watching</span>
          {watch.map((w) => (
            <span key={w.id} className={`chip ${current.startsWith(w.input) ? "on" : ""}`} onClick={() => pull(w.input)} role="button">
              {w.label}<span className="x" onClick={(e) => { e.stopPropagation(); removeWatch(w); }} title="Stop watching">×</span>
            </span>
          ))}
          <input className="input" style={{ width: 200 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="r/subreddit to watch" onKeyDown={(e) => e.key === "Enter" && addWatch()} />
          <button className="btn small" type="button" onClick={addWatch}>Watch</button>
        </div>
        <div className="fetch-row">
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keywords, e.g. range anxiety, service cost, monsoon riding (searched inside the subreddit you click, or across Reddit)" onKeyDown={(e) => e.key === "Enter" && pull("", keyword)} />
          <button className="btn primary" type="button" disabled={busy} onClick={() => pull("", keyword)}>{busy ? "Fetching…" : "Search Reddit"}</button>
        </div>
        {busy ? <div className="progress"><span /></div> : null}
        {result ? (
          <div className="stack">
            {result.note ? <div className="note small">{result.note}</div> : null}
            <div className="eyebrow" style={{ marginBottom: 0 }}>{current} · {result.items.length} posts</div>
            {result.items.map((i) => {
              const done = savedOrigins.has(i.image || i.link);
              return (
                <div key={i.key} className={`idea ${done ? "done" : ""}`}>
                  <div>
                    <strong>{i.title}</strong>
                    {i.notes ? <p>{i.notes}</p> : null}
                    <div className="tags">
                      <Pill tone="info">{i.competitor}</Pill>
                      <Pill>{i.format}</Pill>
                      <a className="btn small ghost" href={i.link} target="_blank" rel="noreferrer">Thread ↗</a>
                      {typeof i.meta?.external === "string" && i.meta.external ? <a className="btn small ghost" href={i.meta.external} target="_blank" rel="noreferrer">Article ↗</a> : null}
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 8, justifyItems: "end" }}>
                    {i.image ? (
                      <button type="button" className="plain-pic" title="Open it here" onClick={() => setAt(pics.findIndex((x) => x.key === i.key))}>
                        <Preview src={i.image} style={{ width: 110, height: 110, objectFit: "cover", background: "var(--oat)" }} />
                      </button>
                    ) : null}
                    {done ? <Pill tone="ok">saved</Pill> : <button className="btn small primary" type="button" disabled={saving} onClick={() => saveOne(i)}>{i.image ? "Save image" : "Save idea"}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="Pick a subreddit above" hint="Click a chip to load its top posts for the week, or search a keyword across Reddit." />
        )}
      </section>

      <div className="sec"><span className="t">Saved ideas</span><span className="idx">[{String(items.length).padStart(3, "0")}]</span><span className="rule" /></div>
      <LibraryGrid items={items} onDelete={onDelete} emptyTitle="No ideas saved yet" emptyHint="Save a thread above. Text ideas keep the title, the gist and the link." />
      {at !== null ? <ImageViewer items={viewItems} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow="From Reddit" /> : null}
    </div>
  );
}

type IgPost = { caption: string; likes: number; comments: number; type: string; permalink: string; timestamp: string; media_url: string; standout: boolean };
type IgAccount = { handle: string; competitor: string; followers: number; posts: IgPost[] };
type IgSync = { at: string; days: number; saved: number; already: number; errors: string[]; accounts: { competitor: string; saved: number; recent: number }[] };

/* Competitors' recent Instagram posts through Meta's official Business Discovery API:
   what they posted, how it did, and a one-click save into your inspiration. */
function InstagramBox({ competitors, savedOrigins, onSaved, push }: { competitors: Competitor[]; savedOrigins: Set<string>; onSaved: () => void; push: Push }) {
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [saving, setSaving] = useState("");
  const [sync, setSync] = useState<IgSync | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const withHandles = competitors.filter((c) => c.instagram);
  const pics = useMemo(() => accounts.flatMap((acc) => acc.posts.map((p) => ({ acc, p }))), [accounts]);
  useEffect(() => { api<{ last_sync: IgSync | null }>("/api/inspiration/instagram").then((r) => setSync(r.last_sync)).catch(() => null); }, []);
  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await postJson<IgSync>("/api/inspiration/instagram", { action: "sync", days: 7 });
      setSync(r);
      push(r.saved ? `Saved ${r.saved} new post${r.saved === 1 ? "" : "s"} from the last 7 days` : "Nothing new since the last check", r.saved ? "ok" : "");
      onSaved();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const load = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const r = await api<{ accounts: IgAccount[]; errors: string[] }>("/api/inspiration/instagram");
      setAccounts(r.accounts);
      setErrors(r.errors);
      setNeedsSetup(false);
      if (!r.accounts.length && r.errors.length) push(r.errors[0], "bad");
    } catch (e) {
      const msg = (e as Error).message;
      setNeedsSetup(/connect instagram/i.test(msg));
      if (!/connect instagram/i.test(msg)) push(msg, "bad");
    } finally {
      setBusy(false);
    }
  };

  const save = async (acc: IgAccount, p: IgPost) => {
    setSaving(p.permalink);
    try {
      const r = await postJson<ImportResult>("/api/inspiration/instagram", { posts: [{ ...p, competitor: acc.competitor }] });
      push(r.created.length ? `Saved to inspiration` : r.skipped.length ? "Already saved" : r.errors[0]?.error || "Couldn't save", r.created.length ? "ok" : "bad");
      onSaved();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>Their Instagram</h3>
          <span className="actions">
            <button className="btn small" type="button" disabled={busy || !withHandles.length} onClick={load}>{busy ? "Reading…" : accounts.length ? "Refresh" : "Load their posts"}</button>
            <button className="btn small primary" type="button" disabled={busy || !withHandles.length} onClick={syncNow}>Save the last 7 days</button>
          </span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Reads recent posts from {withHandles.length ? withHandles.map((c) => `@${c.instagram}`).join(", ") : "your competitors"} through Meta&apos;s official API, with likes, comments and format. Posts doing at least twice that account&apos;s usual engagement are marked as standing out.
        </p>
        {sync ? (
          <p className="small muted" style={{ margin: 0 }}>
            Updated by itself every few hours. Last check {new Date(sync.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}: {sync.saved ? `${sync.saved} new post${sync.saved === 1 ? "" : "s"} saved` : "nothing new"}{sync.already ? `, ${sync.already} already here` : ""}.{sync.errors.length ? ` Couldn't read: ${sync.errors[0]}` : ""}
          </p>
        ) : null}
        {needsSetup ? <div className="note"><strong>Instagram isn&apos;t connected yet</strong>Open <Link href="/settings" style={{ textDecoration: "underline" }}>Settings</Link>, save your Meta token, then press Find my Instagram account.</div> : null}
        {errors.length ? <div className="note bad"><strong>Some accounts couldn&apos;t be read</strong>{errors.join(" · ")}</div> : null}
        {!withHandles.length ? <div className="note">Add each competitor&apos;s Instagram handle in the Competitors box first.</div> : null}
      </section>

      {accounts.map((acc) => (
        <section key={acc.handle} className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>{acc.competitor} · @{acc.handle}</h3>
            <span className="actions">
              {acc.followers ? <Pill>{acc.followers.toLocaleString("en-IN")} followers</Pill> : null}
              <a className="btn small ghost" href={igUrl(acc.handle)} target="_blank" rel="noreferrer">Open ↗</a>
            </span>
          </div>
          <div className="src-grid">
            {acc.posts.map((p) => (
              <div key={p.permalink} className={`src-card ref-card ${savedOrigins.has(`ig:${p.permalink}`) ? "done" : ""}`}>
                <div className="pic" title="Open it here" onClick={() => setAt(pics.findIndex((x) => x.p.permalink === p.permalink))}>
                  {p.media_url ? <img src={p.media_url} alt="" loading="lazy" /> : <span className="small muted">No image</span>}
                </div>
                {p.standout ? <span className="match-tag">Doing well</span> : null}
                <div className="ref-foot">
                  <span className="small">{p.type} · {p.likes.toLocaleString("en-IN")} likes · {p.comments.toLocaleString("en-IN")} comments</span>
                  <span className="actions">
                    <button className="btn small" type="button" onClick={() => setAt(pics.findIndex((x) => x.p.permalink === p.permalink))}>View</button>
                    <a className="btn small ghost" href={p.permalink} target="_blank" rel="noreferrer">See post</a>
                    <button className="btn small" type="button" disabled={saving === p.permalink || savedOrigins.has(`ig:${p.permalink}`)} onClick={() => save(acc, p)}>
                      {savedOrigins.has(`ig:${p.permalink}`) ? "Saved" : saving === p.permalink ? "Saving…" : "Save"}
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {at !== null ? (
        <ImageViewer
          items={pics.map(({ acc, p }) => ({
            id: p.permalink,
            src: p.media_url,
            title: `@${acc.handle}`,
            subtitle: fmtDay(p.timestamp),
            tags: [{ label: p.type }, ...(p.standout ? [{ label: "Doing well for this account", tone: "ok" }] : [])],
            fields: [{ label: "How it did", value: `${p.likes.toLocaleString("en-IN")} likes · ${p.comments.toLocaleString("en-IN")} comments` }, { label: "Competitor", value: acc.competitor }],
            body: p.caption || "",
            links: [{ label: "See it on Instagram", url: p.permalink }],
            actions: (
              <button className="btn small primary" type="button" disabled={savedOrigins.has(`ig:${p.permalink}`) || saving === p.permalink} onClick={() => save(acc, p)}>
                {savedOrigins.has(`ig:${p.permalink}`) ? "Saved to inspiration" : saving === p.permalink ? "Saving…" : "Save to inspiration"}
              </button>
            ),
          }))}
          index={at}
          onIndex={setAt}
          onClose={() => setAt(null)}
          eyebrow="Their Instagram"
        />
      ) : null}
    </div>
  );
}

