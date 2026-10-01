"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, postJson, fmtDate, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, useToast } from "@/components/ui";

/* The morning briefing for the whole group, and everything it has ever said.

   Ten verticals, scored, with the day's theme on top. Anything scoring 7 or more also goes
   into what Circuit knows, so a policy change found here turns up in the content plan without
   anyone carrying it across. */

type Item = {
  vertical: string; headline: string; what: string; why: string; action: string;
  score: number; impact: string; source_name: string; source_url: string; dated: string;
};
type Run = { id: string; date: string; theme: string; summary: string; items: Item[]; filed: { added: number } | null; seconds: number; mailed?: { status: string; error: string } | null };
type Entry = { id: string; title: string; tags: string; notes: string; created_at: string };
type Pdf = { id: string; date: string; name: string; size: number; theme: string; items: number; pdf_url?: string; source?: string };
type Data = {
  archive: Entry[]; pdfs: Pdf[]; last: { at: string; date: string; items: number } | null;
  verticals: { n: number; name: string; entity: string }[];
  mail: { hook: string; to: string; auto: boolean };
  inbox: { folder: string; waiting: string[] };
  graph?: { ready: boolean }; supabase?: { ready: boolean; bucket: string };
};

const TONE: Record<string, string> = { "direct impact": "bad", "what to expect": "warn", "worth knowing": "info", "good to be aware": "" };

export default function IntelPage() {
  const [d, setD] = useState<Data | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>("/api/intel").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const sweep = async (email: boolean) => {
    setBusy(true);
    try {
      const r = await postJson<Run>("/api/intel", { action: "run", email });
      setRun(r);
      push(`${r.items.length} items in ${r.seconds}s${r.filed?.added ? `, ${r.filed.added} added to what Circuit knows` : ""}${r.mailed ? (r.mailed.status === "sent" ? ", emailed" : `, but the email failed: ${r.mailed.error}`) : ""}`, r.mailed && r.mailed.status !== "sent" ? "bad" : "ok");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const importPdfs = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(ev.target.files || []);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    setBusy(true);
    try {
      const r = await api<{ imported: { name: string; date: string }[]; skipped: string[] }>("/api/intel/import", { method: "POST", body: fd });
      push(r.imported.length ? `Brought in ${r.imported.length} briefing${r.imported.length === 1 ? "" : "s"}${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}` : r.skipped[0] || "Nothing imported", r.imported.length ? "ok" : "bad");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
      ev.target.value = "";
    }
  };

  /* Sends up anything that is still only on this Mac — briefings from before Supabase was
     connected, and any whose upload failed at the time. */
  const pushUp = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ uploaded: number; rows: number; errors: string[] }>("/api/intel", { action: "sync" });
      push(
        r.errors.length
          ? `${r.uploaded} sent up, but ${r.errors.length} failed: ${r.errors[0]}`
          : r.uploaded
            ? `${r.uploaded} briefing${r.uploaded === 1 ? "" : "s"} sent up — every one of them now has a link`
            : "They were all up there already",
        r.errors.length ? "bad" : "ok",
      );
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  /* For when waiting the minute is a minute too long. */
  const lookNow = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ imported: { name: string; date: string }[]; skipped: string[] }>("/api/intel/import", {});
      push(r.imported.length ? `Took ${r.imported.length} briefing${r.imported.length === 1 ? "" : "s"}` : r.skipped[0] || "Nothing in the folder", r.imported.length ? "ok" : "");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const openEntry = async (e: Entry) => {
    const full = await api<{ title: string; text: string }>(`/api/intel?id=${e.id}`);
    setOpen({ title: full.title, text: full.text });
  };

  if (!d) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Daily intel</h2>
          <p className="lede">
            Claude writes the briefing each morning. Circuit takes it from the folder, keeps it, and sends it on.
            Anything filed from it reaches <Link href="/knowledge" style={{ textDecoration: "underline" }}>what Circuit knows</Link>, so it shows up in the content plan too.
          </p>
        </div>
        <span className="actions">
          <label className="btn" title="Hand a PDF over directly instead of using the folder">
            {busy ? "Working…" : "Bring in a PDF"}
            <input type="file" accept="application/pdf" multiple hidden onChange={importPdfs} disabled={busy} />
          </label>
          <button className="btn primary" type="button" disabled={busy} onClick={lookNow}>{busy ? "Looking…" : "Look in the folder now"}</button>
        </span>
      </div>

      <section className="panel stack" style={{ gap: 10 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>The folder</h3>
          <span className="actions">
            {d.inbox?.waiting?.length ? <Pill tone="warn">{d.inbox.waiting.length} waiting</Pill> : <Pill tone="ok">empty — nothing waiting</Pill>}
          </span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Drop this morning&apos;s PDF here and Circuit takes it within the minute: the file goes into the database,
          a copy goes up for a web address, it joins the archive, and at 09:30 it goes out by email.
          Put the date in the filename and it lands on the right day.
        </p>
        <code className="pic-caption" style={{ margin: 0, display: "block", wordBreak: "break-all" }}>{d.inbox?.folder}</code>
        {d.inbox?.waiting?.length ? (
          <p className="small" style={{ margin: 0 }}>Waiting: {d.inbox.waiting.join(", ")}</p>
        ) : null}
        <details className="more">
          <summary>No briefing from Claude this morning? ›</summary>
          <p className="small muted" style={{ marginTop: 8 }}>
            Circuit can do the sweep itself — {d.verticals.length} verticals, scored, and it prints its own PDF.
            Slower and plainer than Claude&apos;s, so it is the stand-in, not the plan.
          </p>
          <button className="btn small" type="button" disabled={busy} onClick={() => sweep(false)}>{busy ? "Sweeping…" : "Sweep it here instead"}</button>
        </details>
      </section>

      {d.last ? (
        <p className="small muted" style={{ margin: 0 }}>
          Last briefing {fmtDate(d.last.at)}.
          {d.mail.hook ? ` It goes out at 09:30 to ${d.mail.to || "nobody yet"}.` : " Sending isn't set up yet — Settings, then Sending mail."}
        </p>
      ) : null}

      {run ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>{run.date}</h3>
            <span className="actions">
              {run.filed?.added ? <Pill tone="ok">{run.filed.added} learned</Pill> : null}
              <Pill>{run.items.length} items</Pill>
            </span>
          </div>
          {run.theme ? <p style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>{run.theme}</p> : null}
          {run.summary ? <p className="small" style={{ margin: 0, lineHeight: 1.6 }}>{run.summary}</p> : null}
          <div className="stack" style={{ gap: 8 }}>
            {run.items.map((i) => (
              <article key={i.headline} className="fact">
                <div className="fact-top">
                  <Pill tone={TONE[i.impact] || ""}>{i.impact}</Pill>
                  <Pill>{i.score}/10</Pill>
                  <span className="small muted">{i.vertical}{i.dated ? ` · ${i.dated}` : ""}</span>
                </div>
                <strong>{i.headline}</strong>
                <p>{i.what}</p>
                <p className="why">Why it matters: {i.why}</p>
                {i.action ? <p className="small muted" style={{ margin: 0 }}>What to do: {i.action}</p> : null}
                <div className="fact-foot"><a href={i.source_url} target="_blank" rel="noreferrer">{i.source_name || "source"} ↗</a></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {d.pdfs?.length ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>The briefings themselves</h3>
            <span className="actions">
              {d.supabase?.ready ? <Pill tone="ok">also in Supabase</Pill> : <Pill tone="warn">on this Mac only</Pill>}
              {d.supabase?.ready ? (
                <button className="btn small ghost" type="button" disabled={busy} onClick={pushUp} title="Send up anything that has no link yet">
                  {busy ? "Sending…" : "Push to Supabase"}
                </button>
              ) : null}
              <Pill>{d.pdfs.length}</Pill>
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Every PDF is kept in the database, so a send always finds the exact file that was mailed{d.supabase?.ready ? ", and a copy in Supabase gives it a link anyone can open" : ""}.</p>
          <div className="list">
            {d.pdfs.map((p) => (
              <div key={p.id} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div>
                  <strong>{p.name}</strong>
                  <p>{Math.round(p.size / 1024)} KB{p.items ? ` · ${p.items} items` : ""}{p.source === "imported" ? " · brought in" : ""}{p.theme ? ` · ${p.theme.slice(0, 60)}` : ""}</p>
                </div>
                <span className="actions">
                  <a className="btn small" href={`/api/intel?pdf=${p.date}`} target="_blank" rel="noreferrer">Open</a>
                  {p.pdf_url ? <a className="btn small ghost" href={p.pdf_url} target="_blank" rel="noreferrer">Link ↗</a> : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>The archive</h3><Pill>{d.archive.length}</Pill></div>
        <p className="small muted" style={{ margin: 0 }}>Every briefing is kept, so trends can be read back across months rather than forgotten by the afternoon.</p>
        {d.archive.length ? (
          <div className="list">
            {d.archive.map((e) => (
              <div key={e.id} className="list-item" style={{ gridTemplateColumns: "1fr auto", cursor: "pointer" }} onClick={() => openEntry(e)}>
                <div><strong>{e.title}</strong><p>{e.notes || e.tags || "—"}</p></div>
                <span className="small muted">{fmtDay(e.created_at)}</span>
              </div>
            ))}
          </div>
        ) : <Empty title="Nothing swept yet" hint="Press Run it now, or leave it — the routine runs every morning." />}
      </section>

      {open ? (
        <Modal title={open.title} eyebrow="Daily intel" onClose={() => setOpen(null)}>
          <div className="pic-caption" style={{ maxHeight: "60vh" }}>{open.text}</div>
        </Modal>
      ) : null}
    </div>
  );
}
