"use client";
import { useEffect, useState } from "react";
import { api, postJson, downloadText, fmtDate } from "@/lib/api";
import { Pill, Empty, useToast, statusTone } from "@/components/ui";
import type { Draft, Brand } from "@/lib/types";

type Field = { key: string; label: string; placeholder?: string; long?: boolean };
const TYPES: { key: string; label: string; hint: string; fields: Field[] }[] = [
  { key: "blog", label: "Blog", hint: "Long-form article for the website. Export as Markdown or HTML for the CMS.", fields: [{ key: "slug", label: "URL slug", placeholder: "challenger-real-world-range" }, { key: "meta", label: "Meta description", placeholder: "155 characters" }, { key: "keywords", label: "Target keywords", placeholder: "electric bike range india" }] },
  { key: "email", label: "Email", hint: "Newsletter, launch mail or nurture step. Export as text for your sending tool.", fields: [{ key: "subject", label: "Subject line" }, { key: "preheader", label: "Preheader" }, { key: "audience", label: "Audience / segment", placeholder: "Test-ride leads, last 30 days" }, { key: "cta", label: "Call to action", placeholder: "Book a test ride" }] },
  { key: "whatsapp", label: "WhatsApp", hint: "Broadcast or template text. Opt-in only. Keep under 1024 characters.", fields: [{ key: "template", label: "Template name", placeholder: "challenger_launch_v1" }, { key: "audience", label: "Audience (opted in)", placeholder: "Dealer enquiries, Chennai" }, { key: "cta", label: "Button / CTA", placeholder: "Reply YES for a call" }] },
  { key: "ad", label: "Ad", hint: "Meta or Google ad proposal. Budget is a proposal until someone approves spend.", fields: [{ key: "platform", label: "Platform", placeholder: "Meta / Google / YouTube" }, { key: "objective", label: "Objective", placeholder: "Test-ride bookings" }, { key: "audience", label: "Audience", placeholder: "25 to 40, Bengaluru, interest EV" }, { key: "budget", label: "Proposed budget", placeholder: "₹ per day and duration" }, { key: "headline", label: "Headline" }, { key: "cta", label: "CTA" }] },
  { key: "caption", label: "Caption", hint: "Reusable social captions and hashtag sets.", fields: [{ key: "platform", label: "Platform" }, { key: "hashtags", label: "Hashtags" }] },
];

function metaOf(d: Draft | null): Record<string, string> {
  try { return d ? (JSON.parse(d.meta || "{}") as Record<string, string>) : {}; } catch { return {}; }
}

export default function DraftsPage() {
  const [type, setType] = useState("blog");
  const [items, setItems] = useState<Draft[]>([]);
  const [sel, setSel] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();
  const def = TYPES.find((t) => t.key === type)!;

  const load = () => api<Draft[]>(`/api/drafts?type=${type}`).then(setItems).catch((e: Error) => push(e.message, "bad"));
  useEffect(() => {
    load();
    setSel(null);
    setTitle("");
    setBody("");
    setMeta({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
  useEffect(() => {
    api<{ brand: Brand }>("/api/settings").then((s) => setBrand(s.brand)).catch(() => null);
  }, []);

  const open = (d: Draft) => { setSel(d); setTitle(d.title); setBody(d.body); setMeta(metaOf(d)); };
  const fresh = () => { setSel(null); setTitle(""); setBody(""); setMeta({}); };

  const save = async (status?: string) => {
    setBusy(true);
    try {
      if (sel) {
        await postJson("/api/drafts", { id: sel.id, title, body, meta, status: status || sel.status }, "PATCH");
      } else {
        const r = await postJson<{ id: string }>("/api/drafts", { type, title: title || "Untitled", body, meta });
        setSel({ id: r.id, type, title, body, meta: JSON.stringify(meta), status: "draft", created_at: "", updated_at: "" });
      }
      push(status ? `Marked ${status}` : "Saved", "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!sel || !confirm("Delete this draft?")) return;
    await api(`/api/drafts?id=${sel.id}`, { method: "DELETE" });
    fresh();
    load();
  };
  const exportDraft = (fmt: "md" | "html" | "txt") => {
    const metaLines = def.fields.filter((f) => meta[f.key]).map((f) => `${f.label}: ${meta[f.key]}`);
    const name = (title || "draft").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    if (fmt === "html") {
      const paras = body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
      downloadText(`<article>\n<h1>${title}</h1>\n${paras}\n</article>\n<!-- ${metaLines.join(" | ")} -->`, `${name}.html`, "text/html");
    } else if (fmt === "md") {
      downloadText(`# ${title}\n\n${metaLines.map((l) => `> ${l}`).join("\n")}\n\n${body}\n`, `${name}.md`, "text/markdown");
    } else {
      downloadText(`${title}\n${metaLines.join("\n")}\n\n${body}\n`, `${name}.txt`);
    }
  };
  const assistantBrief = () => {
    const b = brand;
    const lines = [
      `You are writing a ${def.label.toLowerCase()} for ${b?.name || "our brand"}${b?.tagline ? ` (${b.tagline})` : ""}.`,
      b?.tone ? `Tone: ${b.tone}` : "",
      b?.audience ? `Audience: ${b.audience}` : "",
      b?.claims ? `Only these product claims are approved, do not invent others: ${b.claims}` : "Do not invent product claims, numbers or awards. Leave a [CHECK] marker where a fact is needed.",
      title ? `Working title: ${title}` : "",
      ...def.fields.filter((f) => meta[f.key]).map((f) => `${f.label}: ${meta[f.key]}`),
      body ? `Existing draft or notes:\n${body}` : "",
      "Return the finished piece only, no preamble.",
    ].filter(Boolean);
    navigator.clipboard.writeText(lines.join("\n")).then(() => push("Brief copied. Paste it into ChatGPT, Claude or Grok.", "ok"));
  };

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Drafts</h2>
          <p className="lede">Write blogs, emails, WhatsApp messages and ad copy, then export them.</p>
        </div>
        <div className="tabs">{TYPES.map((t) => <button key={t.key} type="button" className={type === t.key ? "active" : ""} onClick={() => setType(t.key)}>{t.label}</button>)}</div>
      </div>

      <div className="cols-2" style={{ gridTemplateColumns: "minmax(240px, 0.8fr) minmax(0, 1.6fr)" }}>
        <section className="panel">
          <div className="panel-head"><h3>{def.label} drafts</h3><button className="btn small" type="button" onClick={fresh}>New</button></div>
          <p className="small muted" style={{ marginBottom: 10 }}>{def.hint}</p>
          {items.length ? (
            <div className="list">
              {items.map((d) => (
                <div key={d.id} className="list-item" style={{ gridTemplateColumns: "1fr auto", cursor: "pointer", outline: sel?.id === d.id ? "2px solid var(--emerald)" : "none" }} onClick={() => open(d)}>
                  <div><strong>{d.title || "Untitled"}</strong><p>{fmtDate(d.updated_at)} · {d.body.length} chars</p></div>
                  <Pill tone={statusTone(d.status)}>{d.status}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No drafts yet" hint="Start one on the right." />
          )}
        </section>

        <section className="panel stack">
          <div className="panel-head"><h3>{sel ? "Edit" : "New"} {def.label.toLowerCase()}</h3>{sel ? <Pill tone={statusTone(sel.status)}>{sel.status}</Pill> : null}</div>
          <label className="field"><span>Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${def.label} title`} /></label>
          <div className="form-grid">
            {def.fields.map((f) => (
              <label key={f.key} className="field"><span>{f.label}</span><input className="input" value={meta[f.key] || ""} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} placeholder={f.placeholder || ""} /></label>
            ))}
          </div>
          <label className="field"><span>Body <em className="muted">{body.length} characters</em></span><textarea className="textarea" rows={type === "blog" ? 18 : 9} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write here, or copy the assistant brief, generate elsewhere, and paste the result back." /></label>
          <div className="actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => save()}>Save</button>
            {sel && sel.status !== "approved" ? <button className="btn" type="button" disabled={busy} onClick={() => save("approved")}>Approve</button> : null}
            {sel && sel.status === "approved" ? <button className="btn" type="button" disabled={busy} onClick={() => save("draft")}>Back to draft</button> : null}
            <button className="btn" type="button" onClick={assistantBrief}>Copy assistant brief</button>
            <button className="btn ghost" type="button" onClick={() => exportDraft(type === "blog" ? "md" : "txt")} disabled={!body}>Export {type === "blog" ? ".md" : ".txt"}</button>
            {type === "blog" ? <button className="btn ghost" type="button" onClick={() => exportDraft("html")} disabled={!body}>Export .html</button> : null}
            {sel ? <button className="btn danger" type="button" onClick={remove}>Delete</button> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
