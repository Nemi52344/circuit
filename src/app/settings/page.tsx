"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fileUrl } from "@/lib/api";
import { Pill, ViewableImage, useToast } from "@/components/ui";
import { HealthPanel } from "@/components/Health";
import { PublishingPanel } from "@/components/Publishing";
import { MailPanel } from "@/components/Mail";
import type { Brand } from "@/lib/types";

type ClaudeStatus = { installed: boolean; cli_path: string | null; version: string; logged_in: boolean; auth_method: string; higgsfield: boolean; mcp_detail: string; ready: boolean };

type Settings = { has_key: boolean; key_hint: string; has_meta: boolean; meta_hint: string; has_hf: boolean; hf_hint: string; ig_user_id: string; brand: Brand; defaults: Brand };

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [meta, setMeta] = useState("");
  const [metaMsg, setMetaMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [hfId, setHfId] = useState("");
  const [hfSecret, setHfSecret] = useState("");
  const [hfMsg, setHfMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [cc, setCc] = useState<ClaudeStatus | null>(null);
  const [ccBusy, setCcBusy] = useState(false);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [researchKick, setResearchKick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const { push, view } = useToast();

  const load = () => api<Settings>("/api/settings").then((x) => { setS(x); setBrand(x.brand); }).catch((e: Error) => push(e.message, "bad"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async () => {
    if (!key.trim()) return push("Paste the key first", "bad");
    setBusy(true);
    try {
      const t = await postJson<{ ok: boolean; message: string }>("/api/settings/test-key", { key });
      setTestMsg(t);
      if (!t.ok) return push(`Key rejected: ${t.message}`, "bad");
      await postJson("/api/settings", { gemini_key: key });
      setKey("");
      push("Google AI key connected", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const testSaved = async () => {
    setBusy(true);
    try { setTestMsg(await postJson<{ ok: boolean; message: string }>("/api/settings/test-key", {})); } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const removeKey = async () => {
    if (!confirm("Remove the stored key?")) return;
    await postJson("/api/settings", { gemini_key: null });
    setTestMsg(null);
    push("Key removed");
    load();
  };
  const saveMeta = async () => {
    if (!meta.trim()) return push("Paste the token first", "bad");
    setBusy(true);
    try {
      const t = await postJson<{ ok: boolean; message: string }>("/api/settings/test-meta", { token: meta });
      setMetaMsg(t);
      if (!t.ok) return push("Token rejected", "bad");
      await postJson("/api/settings", { meta_token: meta });
      setMeta("");
      push(t.message || "Meta connected", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const testMeta = async () => {
    setBusy(true);
    try { setMetaMsg(await postJson<{ ok: boolean; message: string }>("/api/settings/test-meta", {})); } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const removeMeta = async () => {
    if (!confirm("Remove the stored Meta token?")) return;
    await postJson("/api/settings", { meta_token: null });
    setMetaMsg(null);
    push("Meta token removed");
    load();
  };

  const loadClaude = useCallback(async () => {
    setCcBusy(true);
    try { setCc(await api<ClaudeStatus>("/api/claude")); } catch (e) { push((e as Error).message, "bad"); } finally { setCcBusy(false); }
  }, [push]);
  useEffect(() => { loadClaude(); }, [loadClaude]);
  const claudeAction = async (action: string) => {
    setCcBusy(true);
    try {
      const r = await postJson<{ message: string }>("/api/claude/setup", { action });
      push(r.message, "ok");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setCcBusy(false);
    }
  };

  const saveHf = async () => {
    if (!hfId.trim() || !hfSecret.trim()) return push("Both the key id and the secret are needed", "bad");
    setBusy(true);
    try {
      const t = await postJson<{ ok: boolean; message: string }>("/api/settings/test-higgsfield", { key_id: hfId, key_secret: hfSecret });
      setHfMsg(t);
      if (!t.ok) return push("Higgsfield rejected the key", "bad");
      await postJson("/api/settings", { hf_key_id: hfId, hf_key_secret: hfSecret });
      setHfId("");
      setHfSecret("");
      push("Higgsfield connected", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const testHf = async () => {
    setBusy(true);
    try { setHfMsg(await postJson<{ ok: boolean; message: string }>("/api/settings/test-higgsfield", {})); } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const removeHf = async () => {
    if (!confirm("Remove the stored Higgsfield key?")) return;
    await postJson("/api/settings", { hf_key_id: null, hf_key_secret: null });
    setHfMsg(null);
    push("Higgsfield key removed");
    load();
  };

  const saveBrand = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!brand) return;
    setBusy(true);
    try {
      const websiteChanged = (brand.website || "").trim() !== (s?.brand.website || "").trim();
      await postJson("/api/settings", { brand });
      push("Brand saved", "ok");
      await load();
      // a new website means Claude should learn the brand again
      if (websiteChanged && brand.website?.trim()) setResearchKick((n) => n + 1);
    } catch (err) { push((err as Error).message, "bad"); } finally { setBusy(false); }
  };

  if (!s || !brand) return <p className="muted">Loading…</p>;

  const checking = cc === null;
  const steps = [
    {
      done: Boolean(cc?.logged_in),
      title: "Sign in to Claude",
      detail: checking ? "Checking…" : !cc?.installed ? "Claude Code isn't installed on this Mac yet." : cc.logged_in ? "Signed in." : "Opens Claude's own sign-in in a Terminal window.",
      action: () => claudeAction("login"),
      label: "Sign in",
    },
    {
      done: Boolean(cc?.higgsfield),
      title: "Connect Higgsfield",
      detail: checking ? "Checking…" : cc?.higgsfield ? "Connected. Images use your Higgsfield credits." : "Lets Claude create images with your Higgsfield plan.",
      action: () => claudeAction("add-higgsfield"),
      label: "Connect",
    },
  ];

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p className="lede">Connect image creation and set up your brand. Everything is saved on this Mac.</p>
        </div>
      </div>

      <HealthPanel push={push} />
      <PublishingPanel push={push} />
      <MailPanel push={push} />
      <ChatGptPanel push={push} />
      <ApproversPanel push={push} />

      <section className="panel stack">
        <div className="panel-head">
          <h3>Image creation</h3>
          {checking ? <Pill>Checking…</Pill> : cc?.ready ? <Pill tone="ok">Ready</Pill> : <Pill tone="warn">{steps.filter((x) => !x.done).length} step{steps.filter((x) => !x.done).length === 1 ? "" : "s"} left</Pill>}
        </div>
        <p className="small muted" style={{ marginTop: -8 }}>Uses your Claude subscription and Higgsfield credits. No API keys.</p>
        <div className="checks">
          {steps.map((step) => (
            <div key={step.title} className="check">
              <i className={step.done ? "ok" : ""} />
              <div><strong>{step.title}</strong><p>{step.detail}</p></div>
              {step.done ? <Pill tone="ok">Done</Pill> : <button className="btn small primary" type="button" disabled={ccBusy || checking || !cc?.installed} onClick={step.action}>{step.label}</button>}
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="btn small" type="button" disabled={ccBusy} onClick={loadClaude}>{ccBusy ? "Checking…" : "Check again"}</button>
        </div>
      </section>

      <form className="panel stack" onSubmit={saveBrand}>
        <div className="panel-head"><h3>Your brand</h3></div>
        <p className="small muted" style={{ marginTop: -8 }}>Used whenever Circuit writes a prompt or a brief.</p>
        <div className="form-grid">
          <label className="field full"><span>Website <em>ChatGPT reads it to learn what you sell, who buys and what they care about</em></span><input className="input" value={brand.website || ""} onChange={(e) => setBrand({ ...brand, website: e.target.value })} placeholder="https://www.yourbrand.in" /></label>
          <label className="field"><span>Brand name</span><input className="input" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></label>
          <label className="field"><span>Tagline</span><input className="input" value={brand.tagline} onChange={(e) => setBrand({ ...brand, tagline: e.target.value })} /></label>
          <label className="field full"><span>How you sound</span><textarea className="textarea" rows={2} value={brand.tone} onChange={(e) => setBrand({ ...brand, tone: e.target.value })} /></label>
          <label className="field"><span>Who it&apos;s for</span><input className="input" value={brand.audience} onChange={(e) => setBrand({ ...brand, audience: e.target.value })} /></label>
          <label className="field"><span>Brand colours</span><input className="input" value={brand.colors} onChange={(e) => setBrand({ ...brand, colors: e.target.value })} /></label>
          <label className="field full"><span>Facts you can claim <em>only these appear in copy</em></span><textarea className="textarea" rows={2} value={brand.claims} onChange={(e) => setBrand({ ...brand, claims: e.target.value })} placeholder="For example: 120 km certified range; 3 year battery warranty" /></label>
        </div>
        <div className="actions"><button className="btn primary" type="submit" disabled={busy}>Save</button><button className="btn ghost" type="button" onClick={() => setBrand(s.defaults)}>Reset</button></div>
      </form>

      <BrandLearned kick={researchKick} onUseFacts={(facts) => { if (!brand) return; const next = { ...brand, claims: [brand.claims, ...facts].filter(Boolean).join("; ") }; setBrand(next); postJson("/api/settings", { brand: next }).then(() => push("Added to facts you can claim", "ok")); }} push={push} />
      <ProductFolder push={push} />

      <details className="panel more">
        <summary style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Advanced connections ›</summary>
        <div className="stack" style={{ marginTop: 16 }}>
          <p className="small muted">Optional API keys. You don&apos;t need these to create images.</p>

          <div className="stack" style={{ gap: 10 }}>
            <div className="panel-head" style={{ marginBottom: 0 }}><h3>Meta connection</h3>{s.has_meta ? <Pill tone="ok">Connected</Pill> : <Pill>Not connected</Pill>}</div>
            <p className="small muted">One token covers competitors&apos; Instagram posts and, with the ads_read permission, competitor ads. Get it from the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Graph API Explorer</a>.</p>
            <div className="fetch-row">
              <input className="input" type="password" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="Paste access token" autoComplete="off" />
              <span className="actions">
                <button className="btn primary" type="button" disabled={busy} onClick={saveMeta}>Save</button>
                {s.has_meta ? <button className="btn ghost" type="button" onClick={removeMeta}>Remove</button> : null}
              </span>
            </div>
            {metaMsg ? <div className={`note ${metaMsg.ok ? "ok" : "bad"}`}>{metaMsg.message}</div> : null}
            <InstagramConnect hasToken={s.has_meta} push={push} />
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div className="panel-head" style={{ marginBottom: 0 }}><h3>Higgsfield API</h3>{s.has_hf ? <Pill tone="ok">Connected</Pill> : <Pill>Not connected</Pill>}</div>
            <p className="small muted">A separate paid API balance. Get a key at <a href="https://cloud.higgsfield.ai" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>cloud.higgsfield.ai</a>.</p>
            <div className="form-grid">
              <input className="input" value={hfId} onChange={(e) => setHfId(e.target.value)} placeholder="Key id" autoComplete="off" />
              <input className="input" type="password" value={hfSecret} onChange={(e) => setHfSecret(e.target.value)} placeholder="Key secret" autoComplete="off" />
            </div>
            <div className="actions">
              <button className="btn primary" type="button" disabled={busy} onClick={saveHf}>Save</button>
              {s.has_hf ? <button className="btn" type="button" disabled={busy} onClick={testHf}>Test</button> : null}
              {s.has_hf ? <button className="btn ghost" type="button" onClick={removeHf}>Remove</button> : null}
            </div>
            {hfMsg ? <div className={`note ${hfMsg.ok ? "ok" : "bad"}`}>{hfMsg.message}</div> : null}
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div className="panel-head" style={{ marginBottom: 0 }}><h3>Google Gemini</h3>{s.has_key ? <Pill tone="ok">Connected</Pill> : <Pill>Not connected</Pill>}</div>
            <p className="small muted">Image creation needs billing turned on for your Google project. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>aistudio.google.com</a>.</p>
            <div className="fetch-row">
              <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" autoComplete="off" />
              <span className="actions">
                <button className="btn primary" type="button" disabled={busy} onClick={saveKey}>Save</button>
                {s.has_key ? <button className="btn" type="button" disabled={busy} onClick={testSaved}>Test</button> : null}
                {s.has_key ? <button className="btn ghost" type="button" onClick={removeKey}>Remove</button> : null}
              </span>
            </div>
            {testMsg ? <div className={`note ${testMsg.ok ? "ok" : "bad"}`}>{testMsg.message}</div> : null}
          </div>

          <div className="note small">
            <strong>Your data</strong>
            Everything is stored in <code>data/</code> inside the app folder. Copy that folder to back it up. Nothing is posted or sent without you pressing a button.
          </div>
        </div>
      </details>
    </div>
  );
}

type BrandProfile = {
  sells: string; buyers: string; problem: string; cares: string[]; misunderstands: string[]; complains: string[]; competitors_talk: string[];
  competitors: string[]; keywords: string[]; facts: { fact: string; source: string }[]; content_opportunities: string[]; sources: { title: string; url: string }[]; analysed_at: string;
};
type BrandInfo = { website: string; profile: BrandProfile | null; site: { url: string; crawled_at: string; pages: { url: string; title: string }[]; errors: string[] } | null; job: { status: string; error: string; created_at: string } | null };

function BrandLearned({ kick, onUseFacts, push }: { kick: number; onUseFacts: (facts: string[]) => void; push: (t: string, tone?: string) => void }) {
  const [info, setInfo] = useState<BrandInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<BrandInfo>("/api/brand").then(setInfo).catch(() => null), []);
  const research = useCallback(async () => {
    setBusy(true);
    try {
      const r = await postJson<{ pages: number; errors: string[] }>("/api/brand", {});
      push(r.pages ? `Read ${r.pages} page${r.pages === 1 ? "" : "s"}. ChatGPT is writing the brand profile.` : `Couldn't read the site: ${r.errors[0] || "no text found"}`, r.pages ? "ok" : "bad");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }, [load, push]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (kick) research(); }, [kick, research]);
  const waiting = info?.job && (info.job.status === "queued" || info.job.status === "running");
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [waiting, load]);
  if (!info) return null;
  const p = info.profile;
  const List = ({ title, items }: { title: string; items: string[] }) => items.length ? <div><h4 className="learned-h">{title}</h4><ul className="learned-list">{items.map((x) => <li key={x}>{x}</li>)}</ul></div> : null;
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>What ChatGPT learned about your brand</h3>
        <button className="btn small" type="button" disabled={busy || Boolean(waiting) || !info.website} onClick={research}>{busy ? "Reading the site…" : p ? "Learn again" : "Learn from my website"}</button>
      </div>
      {!info.website ? <p className="small muted" style={{ margin: 0 }}>Add your website above and save. ChatGPT reads it, then researches your audience and competitors. Topic ideas on the calendar build on this.</p> : null}
      {info.site ? <p className="small muted" style={{ margin: 0 }}>Read {info.site.pages.length} page{info.site.pages.length === 1 ? "" : "s"} from {info.site.url}{info.site.errors.length ? `. Couldn't read ${info.site.errors.length}.` : "."}</p> : null}
      {waiting ? <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>ChatGPT is writing your brand profile</strong>It reads your site and searches what your audience and competitors are saying. Usually a few minutes.</div> : null}
      {info.job?.status === "failed" ? <div className="note bad"><strong>ChatGPT couldn&apos;t finish</strong>{info.job.error}</div> : null}
      {p ? (
        <div className="stack" style={{ gap: 14 }}>
          <dl className="kv learned-kv">
            <dt>What you sell</dt><dd>{p.sells}</dd>
            <dt>Who buys it</dt><dd>{p.buyers}</dd>
            {p.problem ? <><dt>Problem it solves</dt><dd>{p.problem}</dd></> : null}
          </dl>
          <div className="cols-2">
            <List title="What your audience cares about" items={p.cares} />
            <List title="What they misunderstand" items={p.misunderstands} />
            <List title="What they complain about" items={p.complains} />
            <List title="What competitors talk about" items={p.competitors_talk} />
          </div>
          {p.keywords.length ? <div className="chips"><span className="chip-label">Research keywords</span>{p.keywords.map((k) => <span key={k} className="pill">{k}</span>)}</div> : null}
          {p.facts.length ? (
            <div className="stack" style={{ gap: 8 }}>
              <h4 className="learned-h">Facts found on your site</h4>
              <ul className="learned-list">{p.facts.map((f) => <li key={f.fact}>{f.fact}{f.source ? <> · <a href={f.source} target="_blank" rel="noreferrer">source</a></> : null}</li>)}</ul>
              <button className="btn small" type="button" style={{ justifySelf: "start" }} onClick={() => onUseFacts(p.facts.map((f) => f.fact))}>Add these to facts you can claim</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ProductFolder({ push }: { push: (t: string, tone?: string) => void }) {
  const [info, setInfo] = useState<{ products: { id: string; name: string; color: string; file_id: string; source_path: string }[]; folder: { root: string; exists: boolean; added: number; total: number } | null } | null>(null);
  const load = useCallback(async (announce = false) => {
    try {
      const r = await api<NonNullable<typeof info>>("/api/products?folder=1");
      setInfo(r);
      if (announce) push(r.folder?.added ? `Added ${r.folder.added} new product photo${r.folder.added === 1 ? "" : "s"}` : "No new photos in the folder", r.folder?.added ? "ok" : "");
    } catch (e) {
      push((e as Error).message, "bad");
    }
  }, [push]);
  useEffect(() => { load(); }, [load]);
  if (!info) return null;
  const fromFolder = info.products.filter((p) => p.source_path);
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Product photos</h3>
        <button className="btn small" type="button" onClick={() => load(true)}>Check the folder</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Drafts put these photos into the inspiration you pick. Drop clean photos into the folder, one subfolder per product, colour in the file name.</p>
      <code className="path">{info.folder?.root}</code>
      {fromFolder.length ? (
        <div className="thumb-strip">{fromFolder.map((p) => (
          <ViewableImage key={p.id} eyebrow="Product photo" alt={`${p.name} ${p.color}`}
            item={{ id: p.id, src: fileUrl(p.file_id), title: p.name, subtitle: p.color || "No colour" }}
            items={fromFolder.map((x) => ({ id: x.id, src: fileUrl(x.file_id), title: x.name, subtitle: x.color || "No colour" }))} />
        ))}</div>
      ) : <p className="small muted" style={{ margin: 0 }}>No photos from the folder yet.</p>}
    </section>
  );
}

type GptStatus = { installed: boolean; path: string | null; version: string; logged_in: boolean; detail: string };
type WorkerRun = { id: string; kind: string; label: string; ok: boolean; error: string; finished_at: string; seconds: number };
type WorkerInfo = { enabled: boolean; busy: boolean; current: { label: string; started_at: string } | null; history: WorkerRun[]; installed: boolean };

function ChatGptPanel({ push }: { push: (t: string, tone?: string) => void }) {
  const [gpt, setGpt] = useState<GptStatus | null>(null);
  const [w, setW] = useState<WorkerInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const loadGpt = useCallback(() => api<GptStatus>("/api/chatgpt").then(setGpt).catch((e: Error) => push(e.message, "bad")), [push]);
  const loadW = useCallback(() => api<WorkerInfo>("/api/worker").then(setW).catch(() => null), []);
  useEffect(() => { loadGpt(); loadW(); const t = setInterval(loadW, 5000); return () => clearInterval(t); }, [loadGpt, loadW]);
  const login = async () => {
    setBusy(true);
    try { const r = await postJson<{ message: string }>("/api/chatgpt", { action: "login" }); push(r.message, "ok"); } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const toggle = async (enabled: boolean) => { setW(await postJson<WorkerInfo>("/api/worker", { enabled })); push(enabled ? "ChatGPT will work automatically" : "Automatic work paused", "ok"); };
  const ready = Boolean(gpt?.installed && gpt.logged_in);
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>ChatGPT</h3>
        {!gpt ? <Pill>Checking…</Pill> : ready ? <Pill tone="ok">Signed in</Pill> : <Pill tone="warn">{gpt.installed ? "Not signed in" : "Not installed"}</Pill>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Uses your own ChatGPT account to learn your brand, write topic ideas, research posts and write captions, automatically. Runs are read-only: it searches the web and sends back text. Images still use Higgsfield.</p>
      {gpt && !gpt.installed ? <div className="note bad"><strong>ChatGPT desktop app not found</strong>Install the ChatGPT app for Mac; it includes Codex, which Circuit uses to sign in.</div> : null}
      <div className="actions">
        {gpt?.installed && !gpt.logged_in ? <button className="btn primary" type="button" disabled={busy} onClick={login}>Sign in with ChatGPT</button> : null}
        <button className="btn small" type="button" onClick={() => { loadGpt(); loadW(); }}>Check again</button>
        {w && ready ? (
          <label className="switch">
            <input type="checkbox" checked={w.enabled} onChange={(e) => toggle(e.target.checked)} />
            <span>Work automatically</span>
          </label>
        ) : null}
      </div>
      {w?.current ? <div className="note"><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>{w.current.label}</strong>Started {new Date(w.current.started_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Usually one to five minutes.</div> : null}
      {w?.history.length ? (
        <details className="more">
          <summary>Recent work ›</summary>
          <ul className="learned-list">{w.history.map((r, i) => <li key={`${r.id}-${i}`}>{r.ok ? "Done" : "Failed"}: {r.label}{r.seconds ? ` · ${r.seconds}s` : ""}{r.error ? ` · ${r.error}` : ""}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

type ApproverRow = { id: string; name: string; role: string; email: string; required: number; active: number };

/* The people who must sign off a post before it can be scheduled. */
function ApproversPanel({ push }: { push: (t: string, tone?: string) => void }) {
  const [list, setList] = useState<ApproverRow[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [required, setRequired] = useState(true);
  const load = useCallback(() => api<ApproverRow[]>("/api/approvers").then((r) => setList(r.filter((x) => x.active))).catch(() => null), []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    try {
      await postJson("/api/approvers", { name, role, email, required });
      setName(""); setRole(""); setEmail(""); setRequired(true);
      push("Approver added", "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };
  const patch = async (id: string, body: Record<string, unknown>) => { await postJson("/api/approvers", { id, ...body }, "PATCH"); load(); };
  const remove = async (a: ApproverRow) => {
    if (!confirm(`Stop asking ${a.name} to approve posts? Their past decisions stay on record.`)) return;
    await api(`/api/approvers?id=${a.id}`, { method: "DELETE" });
    load();
  };
  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}><h3>Team sign-off</h3>{list.length ? <Pill tone="ok">{list.filter((a) => a.required).length} must approve</Pill> : <Pill>Off</Pill>}</div>
      <p className="small muted" style={{ margin: 0 }}>Each person gets their own review link for every post. A post can only be scheduled after everyone marked &ldquo;must approve&rdquo; approves that exact image and captions.</p>
      {list.length ? (
        <div className="sign-list">
          {list.map((a) => (
            <div key={a.id} className="sign-row">
              <div className="sign-who"><strong>{a.name}</strong><small>{[a.role, a.email].filter(Boolean).join(" · ") || "No role"}</small></div>
              <label className="switch"><input type="checkbox" checked={Boolean(a.required)} onChange={(e) => patch(a.id, { required: e.target.checked })} /><span>Must approve</span></label>
              <button className="btn small ghost" type="button" onClick={() => remove(a)}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="form-grid">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" /></label>
        <label className="field"><span>Role</span><input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Founder, Marketing lead, Legal" /></label>
        <label className="field"><span>Email <em>optional, for sending the link</em></span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourcompany.com" /></label>
        <label className="switch" style={{ alignSelf: "end", paddingBottom: 10 }}><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /><span>Must approve</span></label>
      </div>
      <div className="actions"><button className="btn" type="button" disabled={!name.trim()} onClick={add}>Add approver</button></div>
    </section>
  );
}

type IgChoice = { page_id: string; page_name: string; ig_user_id: string; username: string; followers: number };
type IgState = { has_token: boolean; ig_user_id: string; ig_username: string; token_until?: string; scopes?: string[]; auto_renew?: boolean; app_id?: string; handles: { name: string; instagram: string }[] };

/* Instagram, connected through the owner's own Meta token. Circuit finds their Instagram
   professional account for them instead of asking for a 17-digit id. */
/* What this token is actually allowed to do. Each line is a thing Circuit can or can't do
   because of it, so a missing permission is visible here instead of failing later. */
const META_ABILITIES: { need: string[]; label: string; what: string }[] = [
  { need: ["instagram_basic", "pages_show_list"], label: "Read competitors' posts", what: "the Their Instagram box and the 7-day sync" },
  { need: ["instagram_manage_insights"], label: "Read our own numbers", what: "reach, likes, saves on the Results page" },
  { need: ["instagram_content_publish"], label: "Post to Instagram from here", what: "not built yet, and needs this permission" },
  { need: ["instagram_manage_comments"], label: "Read and reply to comments", what: "not built yet, and needs this permission" },
  { need: ["ads_read"], label: "Competitors' ads", what: "the Ad Library search" },
];

function PermissionList({ scopes }: { scopes: string[] }) {
  if (!scopes.length) return null;
  return (
    <ul className="health-list" style={{ marginTop: 2 }}>
      {META_ABILITIES.map((a) => {
        const has = a.need.every((n) => scopes.includes(n));
        return (
          <li key={a.label} className={has ? "ok" : "warn"}>
            <span className={`dot ${has ? "ok" : "warn"}`} />
            <strong>{a.label}</strong>
            <span>{has ? a.what : `Needs ${a.need.filter((n) => !scopes.includes(n)).join(" and ")} — ${a.what}`}</span>
            <span />
          </li>
        );
      })}
    </ul>
  );
}

function InstagramConnect({ hasToken, push }: { hasToken: boolean; push: (t: string, tone?: string) => void }) {
  const [st, setSt] = useState<IgState | null>(null);
  const [choices, setChoices] = useState<IgChoice[]>([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api<IgState>("/api/settings/instagram").then(setSt).catch(() => null), []);
  useEffect(() => { load(); }, [load]);
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await postJson<{ accounts?: IgChoice[]; saved?: IgChoice; message?: string }>("/api/settings/instagram", { action, ...body });
      if (action === "find") {
        setChoices(r.accounts || []);
        push(r.saved ? `Connected @${r.saved.username}` : `Found ${r.accounts?.length} accounts. Pick one.`, "ok");
      }
      if (action === "choose") push(`Connected @${r.saved?.username}`, "ok");
      if (action === "test" || action === "extend") push(r.message || "Done", "ok");
      if (action === "remove") push("Instagram disconnected", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };
  if (!st) return null;
  const connected = Boolean(st.ig_user_id);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3 style={{ fontSize: 14 }}>Competitors&apos; Instagram posts</h3>
        {connected ? <Pill tone="ok">Connected{st.ig_username ? ` as @${st.ig_username}` : ""}</Pill> : <Pill>{hasToken ? "One step left" : "Needs the token above"}</Pill>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Reads recent posts and engagement from the handles in Inspiration ({st.handles.length ? st.handles.map((h) => `@${h.instagram}`).join(", ") : "none yet"}). Your Instagram professional account must be linked to a Facebook Page.
        {st.token_until ? ` This token runs out on ${st.token_until}.` : ""}
      </p>
      <PermissionList scopes={st.scopes || []} />
      <div className="actions">
        <button className="btn" type="button" disabled={!hasToken || Boolean(busy)} onClick={() => act("find")}>{busy === "find" ? "Looking…" : connected ? "Find again" : "Find my Instagram account"}</button>
        {connected ? <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => act("test")}>{busy === "test" ? "Testing…" : "Test"}</button> : null}
        {connected ? <button className="btn ghost" type="button" disabled={Boolean(busy)} onClick={() => act("remove")}>Disconnect</button> : null}
      </div>
      {st.auto_renew ? (
        <div className="note ok small">
          <strong>Circuit keeps this connection alive by itself</strong>
          The token is swapped for a fresh 60-day one before it runs out{st.token_until ? `, currently good until ${st.token_until}` : ""}. Nothing to remember.
          <div className="actions" style={{ marginTop: 6 }}>
            <button className="btn small ghost" type="button" disabled={Boolean(busy)} onClick={() => act("forget_app")}>Stop renewing automatically</button>
          </div>
        </div>
      ) : (
        <div className="note warn small">
          <strong>This token dies in about an hour unless you do this once</strong>
          A token from the Graph API Explorer is short-lived, which is why competitors&apos; posts keep stopping. Paste your app&apos;s id and secret (Meta, My Apps, Circuit BNC, Settings, Basic) and Circuit swaps it for a 60-day one — and from then on renews it by itself, so you never come back here.
          <div className="form-grid" style={{ marginTop: 8 }}>
            <input className="input" id="fb-app-id" placeholder="App id" autoComplete="off" defaultValue={st.app_id || ""} />
            <input className="input" id="fb-app-secret" type="password" placeholder="App secret" autoComplete="off" />
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn primary" type="button" disabled={Boolean(busy) || !hasToken} onClick={() => act("extend", {
              app_id: (document.getElementById("fb-app-id") as HTMLInputElement).value,
              app_secret: (document.getElementById("fb-app-secret") as HTMLInputElement).value,
            })}>{busy === "extend" ? "Renewing…" : "Renew and keep it renewed"}</button>
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>Both stay on this Mac beside the token and are only ever sent to Meta. The token has to be alive when you press this — if it has already expired, generate a fresh one in the Explorer and save it first.</p>
        </div>
      )}
      {choices.length > 1 ? (
        <div className="sign-list">
          {choices.map((c) => (
            <div key={c.ig_user_id} className="sign-row">
              <div className="sign-who"><strong>@{c.username}</strong><small>{c.page_name}{c.followers ? ` · ${c.followers.toLocaleString("en-IN")} followers` : ""}</small></div>
              <div />
              <button className="btn small" type="button" disabled={Boolean(busy) || st.ig_user_id === c.ig_user_id} onClick={() => act("choose", { ig_user_id: c.ig_user_id })}>{st.ig_user_id === c.ig_user_id ? "In use" : "Use this"}</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
