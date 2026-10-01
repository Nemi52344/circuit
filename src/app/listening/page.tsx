"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, useToast } from "@/components/ui";
import { Kpi, Tabs } from "@/components/Sheet";
import type { Comment } from "@/lib/listen";

/* What people said back, and what to say to them.

   Circuit drafts every reply in the brand's voice and then stops. You read it, change what is
   wrong, copy it, and post it yourself. That is deliberate: a reply from the brand account is
   the brand speaking in public, usually to somebody who is annoyed, and nothing in this app
   should do that on its own at half past nine in the morning. */

type Reach = { platform: string; connected: boolean; canRead: boolean; note: string };
type Data = {
  comments: Comment[];
  summary: { waiting: number; drafted: number; sent: number; complaints: number; questions: number };
  reach: Reach[]; kinds: string[]; statuses: string[];
};

const KIND_TONE: Record<string, string> = { complaint: "bad", question: "warn", buying: "ok", praise: "ok", spam: "" };

export default function ListeningPage() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState("open");
  const [busy, setBusy] = useState("");
  const [paste, setPaste] = useState<{ platform: string; text: string; post: string } | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>("/api/listening").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const r = await postJson<Record<string, unknown>>("/api/listening", body);
      if (body.action === "draft") {
        const n = Number(r.drafted || 0);
        const errs = (r.errors as string[]) || [];
        push(errs.length ? errs[0] : n ? `${n} repl${n === 1 ? "y" : "ies"} drafted — read them before sending` : "Nothing new to answer", errs.length ? "bad" : n ? "ok" : "");
      } else if (body.action === "pull") {
        const errs = (r.errors as string[]) || [];
        push(errs.length ? errs[0] : `${r.added} new of ${r.found} found`, errs.length ? "bad" : "ok");
      } else if (body.action === "paste") {
        push(`${r.added} added`, "ok");
        setPaste(null);
      }
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    try { await postJson("/api/listening", { id, ...body }); load(); }
    catch (e) { push((e as Error).message, "bad"); }
  };

  const copy = async (c: Comment) => {
    try {
      await navigator.clipboard.writeText(c.draft);
      push("Copied — paste it into the post and then mark it sent", "ok");
    } catch { push("Could not reach the clipboard; select the text instead", "bad"); }
  };

  if (!d) return <p className="muted">Loading…</p>;
  const s = d.summary;
  const shown = d.comments.filter((c) =>
    tab === "open" ? c.status === "new" || c.status === "drafted"
      : tab === "sent" ? c.status === "sent"
      : tab === "ignored" ? c.status === "ignored" : true);

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Listening</h2>
          <p className="lede">
            Comments on our own posts, and a reply drafted for each one in our voice.
            Circuit writes them; you send them. Nothing here is posted on its own.
          </p>
        </div>
        <span className="actions">
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => setPaste({ platform: "LinkedIn", text: "", post: "" })}>Paste comments</button>
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => act({ action: "pull" }, "pull")}>{busy === "pull" ? "Reading…" : "Read Instagram"}</button>
          <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={() => act({ action: "draft" }, "draft")}>{busy === "draft" ? "Writing…" : "Draft the replies"}</button>
        </span>
      </div>

      <div className="grid-cards">
        <Kpi label="Waiting on you" value={String(s.waiting)} hint={s.drafted ? `${s.drafted} already drafted` : "nothing drafted yet"} tone={s.waiting ? "graphite" : ""} />
        <Kpi label="Complaints" value={String(s.complaints)} hint={s.complaints ? "Answer these first" : "none open"} tone={s.complaints ? "graphite" : ""} />
        <Kpi label="Questions" value={String(s.questions)} />
        <Kpi label="Replied" value={String(s.sent)} hint="Marked sent by you" />
      </div>

      <section className="panel stack" style={{ gap: 10 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>Where we can listen</h3></div>
        <div className="list">
          {d.reach.map((r) => (
            <div key={r.platform} className="list-item" style={{ gridTemplateColumns: "auto 1fr auto" }}>
              <div className={`dot ${r.canRead ? "ok" : r.connected ? "warn" : "bad"}`} />
              <div><strong>{r.platform}</strong><p>{r.note}</p></div>
              <Pill tone={r.canRead ? "ok" : ""}>{r.canRead ? "reads by itself" : "paste it in"}</Pill>
            </div>
          ))}
        </div>
      </section>

      <Tabs
        tabs={[
          { key: "open", label: "To answer", count: d.comments.filter((c) => c.status === "new" || c.status === "drafted").length },
          { key: "sent", label: "Replied", count: d.comments.filter((c) => c.status === "sent").length },
          { key: "ignored", label: "Left alone", count: d.comments.filter((c) => c.status === "ignored").length },
          { key: "all", label: "Everything", count: d.comments.length },
        ]}
        active={tab} onPick={setTab}
      />

      {shown.length ? (
        <div className="stack" style={{ gap: 10 }}>
          {shown.map((c) => (
            <section key={c.id} className="panel stack" style={{ gap: 9 }}>
              <div className="fact-top">
                <Pill>{c.platform}</Pill>
                {c.kind !== "unsorted" ? <Pill tone={KIND_TONE[c.kind] || ""}>{c.kind}</Pill> : null}
                <span className="small muted">
                  {c.author ? `${c.author} · ` : ""}{c.posted_at ? fmtDay(c.posted_at) : ""}
                  {c.post_title ? ` · on “${c.post_title}”` : ""}
                </span>
                {c.post_ref?.startsWith("http") ? <a className="btn small ghost" href={c.post_ref} target="_blank" rel="noreferrer">See the post ↗</a> : null}
              </div>
              <blockquote className="said">{c.text}</blockquote>

              {c.draft ? (
                <>
                  <label className="field">
                    <span>Our reply <em className="muted">change anything you do not like</em></span>
                    <textarea className="textarea" rows={3} defaultValue={c.draft}
                      onBlur={(e) => e.target.value !== c.draft && patch(c.id, { draft: e.target.value })} />
                  </label>
                  {c.why ? <p className="small muted" style={{ margin: 0 }}>Why this: {c.why}</p> : null}
                  <div className="actions">
                    <button className="btn small primary" type="button" onClick={() => copy(c)}>Copy the reply</button>
                    {c.status !== "sent" ? <button className="btn small" type="button" onClick={() => patch(c.id, { status: "sent" })}>I have posted it</button> : null}
                    <button className="btn small ghost" type="button" onClick={() => patch(c.id, { status: "ignored" })}>Leave it</button>
                  </div>
                </>
              ) : (
                <div className="actions">
                  <span className="small muted">No reply drafted yet.</span>
                  <button className="btn small" type="button" disabled={Boolean(busy)} onClick={() => act({ action: "draft" }, "draft")}>Draft the replies</button>
                  <button className="btn small ghost" type="button" onClick={() => patch(c.id, { status: "ignored" })}>Leave it</button>
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <Empty title={tab === "open" ? "Nothing waiting" : "Nothing here"}
          hint={tab === "open" ? "Paste comments from LinkedIn or X, or read Instagram if the permission is on." : ""} />
      )}

      {paste ? (
        <Modal title="Paste comments" eyebrow="One per line" onClose={() => setPaste(null)}>
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              Copy the comments off the post and paste them here, one per line.
              <code>Name: what they said</code> is understood; a bare line works too.
            </p>
            <div className="form-grid">
              <label className="field"><span>Where from</span>
                <select className="select" value={paste.platform} onChange={(e) => setPaste({ ...paste, platform: e.target.value })}>
                  <option>LinkedIn</option><option>X</option><option>Instagram</option><option>Facebook</option><option>YouTube</option>
                </select>
              </label>
              <label className="field"><span>Which post <em className="muted">optional</em></span>
                <input className="input" value={paste.post} onChange={(e) => setPaste({ ...paste, post: e.target.value })} placeholder="so the reply knows what it is under" />
              </label>
            </div>
            <label className="field"><span>The comments</span>
              <textarea className="textarea" rows={9} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })}
                placeholder={"Ramesh: what is the real range in city traffic?\nPriya: service centre near Velachery?"} />
            </label>
            <div className="actions">
              <button className="btn primary" type="button" disabled={!paste.text.trim() || Boolean(busy)}
                onClick={() => act({ action: "paste", platform: paste.platform, paste: paste.text, post_title: paste.post }, "paste")}>Add them</button>
              <button className="btn ghost" type="button" onClick={() => setPaste(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
