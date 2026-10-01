"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, postJson, fileUrl, downloadUrl, fmtDate } from "@/lib/api";
import { Pill, Empty, Modal, ImageViewer, ViewableImage, useToast } from "@/components/ui";
import type { ViewerItem } from "@/components/ui";
import type { Inspiration, Product } from "@/lib/types";

type RunResult = { id: string; file_id: string; model: string; title: string; note: string; status: string };
type Pkg = { prompt: string; steps: string[]; ref_file_id: string | null; product_file_id: string };
type RenderJob = {
  id: string; provider: string; kind: string; model: string; prompt: string; status: string; error: string; cost: string;
  creation_id: string | null; created_at: string; updated_at: string; result_file_id?: string | null; reference_file_id?: string | null;
  inspiration_title?: string; competitor?: string; product_name?: string; product_color?: string;
};
type HfModelInfo = { id: string; label: string; refs: string; note: string };

export default function CreationPage() {
  return (
    <Suspense fallback={<p className="muted">Loading studio…</p>}>
      <Studio />
    </Suspense>
  );
}

function Studio() {
  const params = useSearchParams();
  const { push, view } = useToast();
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [refId, setRefId] = useState<string>(params.get("ref") || "");
  const [productId, setProductId] = useState<string>("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [resultSaved, setResultSaved] = useState(false);
  const [error, setError] = useState("");
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [uploading, setUploading] = useState(false);
  const [libBusy, setLibBusy] = useState(false);
  const [libFiles, setLibFiles] = useState<File[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [refAt, setRefAt] = useState<number | null>(null);
  const libForm = useRef<HTMLFormElement>(null);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [hfModel, setHfModel] = useState("gpt_image_2_5");
  const [hfModels, setHfModels] = useState<HfModelInfo[]>([]);
  const [claudeModels, setClaudeModels] = useState<HfModelInfo[]>([]);
  const [hfConnected, setHfConnected] = useState<boolean | null>(null);
  const [hfBusy, setHfBusy] = useState(false);
  const [restModel, setRestModel] = useState("soul-reference");
  const [queuing, setQueuing] = useState(false);

  const loadJobs = async () => {
    try { setJobs(await api<RenderJob[]>("/api/render")); } catch { /* the queue is optional; the studio still works */ }
  };
  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, 5000);
    api<{ connected: boolean; models: HfModelInfo[] }>("/api/higgsfield/run")
      .then((r) => { setHfConnected(r.connected); setHfModels(r.models); })
      .catch(() => setHfConnected(false));
    api<HfModelInfo[]>("/api/render?models=1")
      .then((m) => { setClaudeModels(m); setHfModel((cur) => (m.some((x) => x.id === cur) ? cur : m[0]?.id || "gpt_image_2_5")); })
      .catch(() => null);
    return () => clearInterval(t);
  }, []);

  const loadAll = async () => {
    const [i, p, s] = await Promise.all([
      api<Inspiration[]>("/api/inspirations"),
      api<Product[]>("/api/products"),
      api<{ has_key: boolean }>("/api/settings"),
    ]);
    setInspirations(i.filter((x) => x.file_id));
    setProducts(p);
    setHasKey(s.has_key);
    if (!productId && p.length) setProductId(p[0].id);
  };
  useEffect(() => {
    loadAll().catch((e: Error) => push(e.message, "bad"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ref = inspirations.find((i) => i.id === refId) || null;
  const product = products.find((p) => p.id === productId) || null;
  const ready = Boolean(ref && product);

  const run = async () => {
    if (!ready) return push("Pick a reference and a product photo first", "bad");
    setBusy(true);
    setError("");
    setResult(null);
    setResultSaved(false);
    try {
      const r = await postJson<RunResult>("/api/creation/run", { inspiration_id: refId, product_id: productId, instructions });
      setResult(r);
      push(`Generated with ${r.model}`, "ok");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveToWall = async () => {
    if (!result) return;
    await postJson("/api/creations", { id: result.id, status: "saved" }, "PATCH");
    setResultSaved(true);
    push("Saved to the wall", "ok");
  };

  const openPackage = async () => {
    if (!ready) return push("Pick a reference and a product photo first", "bad");
    try {
      setPkg(await postJson<Pkg>("/api/creation/package", { inspiration_id: refId, product_id: productId, instructions }));
    } catch (e) {
      push((e as Error).message, "bad");
    }
  };

  const uploadAssisted = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !pkg) return;
    const fd = new FormData();
    fd.append("files", f);
    fd.append("mode", "assisted");
    fd.append("inspiration_id", refId);
    fd.append("product_id", productId);
    fd.append("prompt", pkg.prompt);
    fd.append("title", `${ref?.title || "Reference"} x ${product?.name || "product"} (assisted)`);
    setUploading(true);
    try {
      await api("/api/creations", { method: "POST", body: fd });
      push("Assisted result saved to the wall", "ok");
      setPkg(null);
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setUploading(false);
    }
  };

  const uploadProducts = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!libFiles.length) return push("Choose product photos first", "bad");
    const fd = new FormData(e.currentTarget);
    fd.delete("files");
    libFiles.forEach((f) => fd.append("files", f));
    setLibBusy(true);
    try {
      const created = await api<Product[]>("/api/products", { method: "POST", body: fd });
      push(`Added ${created.length} photo${created.length > 1 ? "s" : ""}`, "ok");
      setShowLibrary(false);
      libForm.current?.reset();
      setLibFiles([]);
      await loadAll();
      if (created[0]) setProductId(created[0].id);
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setLibBusy(false);
    }
  };

  const removeProduct = async (id: string) => {
    if (!confirm("Remove this product photo?")) return;
    await api(`/api/products?id=${id}`, { method: "DELETE" });
    if (productId === id) setProductId("");
    loadAll();
  };

  const runHiggsfield = async () => {
    if (!ready) return push("Pick a reference and a product photo first", "bad");
    setHfBusy(true);
    setError("");
    setResult(null);
    setResultSaved(false);
    try {
      const r = await postJson<RunResult>("/api/higgsfield/run", { inspiration_id: refId, product_id: productId, instructions, model: restModel });
      setResult(r);
      push(`Generated with ${r.model}`, "ok");
      loadJobs();
    } catch (e) {
      setError((e as Error).message);
      loadJobs();
    } finally {
      setHfBusy(false);
    }
  };
  const queueHiggsfield = async () => {
    if (!ready) return push("Pick a reference and a product photo first", "bad");
    setQueuing(true);
    try {
      const r = await postJson<{ launched?: boolean; reason?: string }>("/api/render", { inspiration_id: refId, product_id: productId, instructions, model: hfModel });
      push(r.launched ? "Creating your image now." : "Added. Your image will appear here in a couple of minutes.", "ok");
      loadJobs();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setQueuing(false);
    }
  };
  const cancelJob = async (j: RenderJob) => {
    if (!confirm("Remove this job from the queue?")) return;
    await api(`/api/render?id=${j.id}`, { method: "DELETE" });
    loadJobs();
  };
  const openJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");

  const needsKey = error.startsWith("needs_key");
  const needsHf = error.startsWith("needs_hf_key");

  const niceTitle = (t?: string) => (!t ? "Image" : /^Pin \d+$/.test(t) ? "Pinterest pin" : t);
  const STATUS_LABEL: Record<string, string> = { queued: "Waiting", running: "Creating…", done: "Ready", failed: "Didn't work", cancelled: "Cancelled" };
  const recentJobs = jobs.slice(0, 8);
  const modelNote = claudeModels.find((m) => m.id === hfModel)?.note;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Create an image</h2>
          <p className="lede">Pick an ad you like and a photo of your bike. We&apos;ll recreate the ad with the Challenger in it.</p>
        </div>
      </div>

      <div className="cols-studio">
        <section className="panel stack">
          <div>
            <div className="panel-head">
              <h3><span className="step-no">1</span> Pick an ad to recreate</h3>
              <Link className="btn small ghost" href="/inspiration">Find more</Link>
            </div>
            {inspirations.length ? (
              <div className="thumb-strip scroll">
                {inspirations.map((i) => (
                  <button key={i.id} type="button" className={i.id === refId ? "selected" : ""} title={i.title} aria-pressed={i.id === refId} onClick={() => setRefId(i.id)}>
                    <img src={fileUrl(i.file_id)} alt={i.title} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty title="No ads saved yet" hint="Save a few in Inspiration first." />
            )}
            {ref ? (
              <p className="small muted" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>Picked: {niceTitle(ref.title)}</span>
                <button className="btn small" type="button" onClick={() => setRefAt(inspirations.findIndex((i) => i.id === ref.id))}>View</button>
              </p>
            ) : null}
          </div>

          <div>
            <div className="panel-head">
              <h3><span className="step-no">2</span> Pick your bike</h3>
              <button className="btn small ghost" type="button" onClick={() => setShowLibrary(true)}>Add photos</button>
            </div>
            {products.length ? (
              <div className="thumb-strip">
                {products.map((p) => (
                  <button key={p.id} type="button" className={p.id === productId ? "selected" : ""} title={`${p.name} ${p.color}`} aria-pressed={p.id === productId} onClick={() => setProductId(p.id)}>
                    <img src={fileUrl(p.file_id)} alt={`${p.name} ${p.color}`} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty title="No bike photos yet" hint="Add a photo of the Challenger to get started." />
            )}
          </div>

          <label className="field">
            <span><span><span className="step-no">3</span> Anything to change? <em>optional</em></span></span>
            <textarea className="textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: keep it a night scene, leave space for a headline at the top" />
          </label>

          <label className="field">
            <span>Style</span>
            <select className="select" value={hfModel} onChange={(e) => setHfModel(e.target.value)}>
              {claudeModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {modelNote ? <em style={{ fontStyle: "normal", fontWeight: 400, color: "var(--muted)" }}>{modelNote}</em> : null}
          </label>

          <button className="btn primary big" type="button" onClick={queueHiggsfield} disabled={!ready || queuing}>
            {queuing ? "Starting…" : "Create image"}
          </button>
          {!ready ? <p className="small muted" style={{ marginTop: -10 }}>Pick an ad and a bike photo first.</p> : null}

          <details className="more">
            <summary>More ways to create ›</summary>
            <div className="stack" style={{ gap: 10 }}>
              <div className="actions">
                <button className="btn small" type="button" onClick={openPackage} disabled={!ready}>Copy for ChatGPT, Claude or Grok</button>
              </div>
              <div className="actions">
                <select className="select" style={{ width: 220 }} value={restModel} onChange={(e) => setRestModel(e.target.value)} title="Higgsfield API model">
                  {hfModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <button className="btn small" type="button" onClick={runHiggsfield} disabled={hfBusy || busy || !ready}>{hfBusy ? "Creating…" : "Higgsfield API"}</button>
                <button className="btn small" type="button" onClick={run} disabled={busy || hfBusy || !ready}>{busy ? "Creating…" : "Gemini API"}</button>
              </div>
              <p className="small muted">These need an API key in Settings. Most people won&apos;t need them.</p>
            </div>
          </details>

          {busy || hfBusy ? <div className="progress"><span /></div> : null}
          {error ? (
            <div className="note bad">
              <strong>{needsHf ? "Higgsfield API isn't connected" : needsKey ? "Gemini isn't connected" : "That didn't work"}</strong>
              {needsHf || needsKey ? <>Use <b>Create image</b> above instead, or add a key in <Link href="/settings" style={{ textDecoration: "underline" }}>Settings</Link>.</> : error}
            </div>
          ) : null}
        </section>

        <section className="panel stack">
          <div className="panel-head">
            <h3>Your images</h3>
            {openJobs.length ? <Pill tone="warn">{openJobs.length} in progress</Pill> : null}
          </div>

          {result ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="result-box"><ViewableImage item={{ id: result.id, src: fileUrl(result.file_id), title: result.title || "New image", subtitle: result.model, body: result.note || "" }} eyebrow="Your image" alt={result.title} /></div>
              <div className="actions">
                <button className="btn primary" type="button" disabled={resultSaved} onClick={saveToWall}>{resultSaved ? "Saved" : "Save to Wall"}</button>
                <button className="btn" type="button" onClick={() => downloadUrl(fileUrl(result.file_id), `${result.title}.png`)}>Download</button>
              </div>
            </div>
          ) : null}

          {recentJobs.length ? (
            <div className="list">
              {recentJobs.map((j) => (
                <div key={j.id} className="list-item">
                  {j.result_file_id ? <ViewableImage className="mini" item={{ id: j.id, src: fileUrl(j.result_file_id), title: niceTitle(j.inspiration_title), subtitle: fmtDate(j.created_at), fields: [{ label: "Made with", value: j.model || j.provider }] }} eyebrow="Image" alt="" />
                    : j.reference_file_id ? <ViewableImage className="mini" style={{ opacity: .45 }} item={{ id: j.id, src: fileUrl(j.reference_file_id), title: "Reference being used", subtitle: fmtDate(j.created_at) }} eyebrow="Reference" alt="" />
                    : <div className="mini empty">…</div>}
                  <div>
                    <strong>{niceTitle(j.inspiration_title)}</strong>
                    <p>{j.status === "failed" && j.error ? j.error.slice(0, 90) : `${j.product_name || "Challenger"}${j.product_color ? ` ${j.product_color}` : ""} · ${fmtDate(j.created_at)}`}</p>
                  </div>
                  <span className="actions">
                    {j.status === "done" ? <Link className="btn small primary" href="/wall">View</Link> : <Pill tone={j.status === "failed" ? "bad" : "warn"}>{STATUS_LABEL[j.status] || j.status}</Pill>}
                    {j.status === "queued" || j.status === "failed" ? <button className="btn small ghost" type="button" aria-label="Remove" onClick={() => cancelJob(j)}>✕</button> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : !result ? (
            <Empty title="Nothing yet" hint="Your images show up here once you press Create image." />
          ) : null}

          {openJobs.length ? <p className="small muted">Images usually take a couple of minutes. They land on the Wall when ready.</p> : null}
        </section>
      </div>

      {showLibrary ? (
        <Modal title="Your bike photos" onClose={() => setShowLibrary(false)}>
          <div className="stack">
            <form ref={libForm} onSubmit={uploadProducts} className="form-grid">
              <label className="field full">
                <span>Photos</span>
                <label className={`file-drop ${libFiles.length ? "active" : ""}`}>
                  <input type="file" name="files" accept="image/*" multiple onChange={(e) => setLibFiles(Array.from(e.target.files || []))} />
                  {libFiles.length ? `${libFiles.length} selected` : "Choose photos of the bike"}
                </label>
              </label>
              <label className="field"><span>Name</span><input className="input" name="name" placeholder="Challenger 110" /></label>
              <label className="field"><span>Colour</span><input className="input" name="color" placeholder="Olive" /></label>
              <div className="actions full"><button className="btn primary" type="submit" disabled={libBusy || !libFiles.length}>{libBusy ? "Uploading…" : "Add photos"}</button></div>
            </form>
            {products.length ? (
              <div className="grid-cards">
                {products.map((p) => (
                  <div key={p.id} className={`card selectable ${p.id === productId ? "selected" : ""}`} onClick={() => setProductId(p.id)}>
                    <div className="thumb square"><ViewableImage
                      item={{ id: p.id, src: fileUrl(p.file_id), title: p.name, subtitle: p.color || "No colour" }}
                      items={products.map((x) => ({ id: x.id, src: fileUrl(x.file_id), title: x.name, subtitle: x.color || "No colour" }))}
                      eyebrow="Bike photo" alt={p.name} /></div>
                    <div className="body">
                      <strong>{p.name}</strong>
                      <p>{p.color || "No colour"}</p>
                      <div className="row"><button className="btn small ghost" type="button" onClick={(e) => { e.stopPropagation(); removeProduct(p.id); }}>Remove</button></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {pkg ? (
        <Modal title="Create it in ChatGPT, Claude or Grok" onClose={() => setPkg(null)}>
          <div className="stack">
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{pkg.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <div className="actions">
              <button className="btn primary" type="button" onClick={() => navigator.clipboard.writeText(pkg.prompt).then(() => push("Copied", "ok"))}>Copy prompt</button>
              {pkg.ref_file_id ? <button className="btn" type="button" onClick={() => downloadUrl(fileUrl(pkg.ref_file_id), "1-ad.png")}>Download ad</button> : null}
              <button className="btn" type="button" onClick={() => downloadUrl(fileUrl(pkg.product_file_id), "2-bike.png")}>Download bike</button>
            </div>
            <label className="field">
              <span>Then upload the image it made</span>
              <label className="file-drop"><input type="file" accept="image/*" onChange={uploadAssisted} disabled={uploading} />{uploading ? "Uploading…" : "Choose the finished image"}</label>
            </label>
          </div>
        </Modal>
      ) : null}
      {refAt !== null ? (
        <ImageViewer
          items={inspirations.map((i) => ({ id: i.id, src: fileUrl(i.file_id as string), title: niceTitle(i.title), subtitle: [i.platform, i.competitor].filter(Boolean).join(" · "), body: i.notes || "", links: i.source_url ? [{ label: "Where it came from", url: i.source_url }] : [], actions: <button className="btn small primary" type="button" onClick={() => { setRefId(i.id); setRefAt(null); }}>Use this one</button> }) as ViewerItem)}
          index={refAt}
          onIndex={setRefAt}
          onClose={() => setRefAt(null)}
          eyebrow="Saved inspiration"
        />
      ) : null}
    </div>
  );
}
