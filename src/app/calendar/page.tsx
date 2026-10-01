"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, postJson, fileUrl, fmtDate, PLATFORMS } from "@/lib/api";
import { Pill, Empty, Modal, ViewableImage, useToast, statusTone } from "@/components/ui";
import type { Post, Creation } from "@/lib/types";

const STATUSES = ["draft", "approved", "scheduled", "posted", "failed"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<p className="muted">Loading calendar…</p>}>
      <Calendar />
    </Suspense>
  );
}

function Calendar() {
  const params = useSearchParams();
  const { push, view } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [creations, setCreations] = useState<Creation[]>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [editing, setEditing] = useState<Post | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* A poster handed straight over, rather than made in the studio. Kept beside the form so the
     picture is on screen before anything is saved. */
  const [picked, setPicked] = useState<{ id: string; name: string; mime: string } | null>(null);

  const load = async () => {
    const [p, c] = await Promise.all([api<Post[]>("/api/posts"), api<Creation[]>("/api/creations")]);
    setPosts(p);
    setCreations(c);
    const want = params.get("post");
    if (want) setEditing(p.find((x) => x.id === want) || null);
  };
  useEffect(() => {
    load().catch((e: Error) => push(e.message, "bad"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = new Date();
  const monthPosts = posts.filter((p) => { const d = new Date(p.scheduled_at); return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear(); });

  /* Straight off the machine and into the post. Anything the library can hold works here —
     a poster, a reel, a photo from a phone — because there is no reason to make somebody route
     a finished file through the studio just to put it on the calendar. */
  const upload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("files", f);
    fd.append("kind", "upload");
    setBusy(true);
    try {
      const saved = await api<{ id: string; name: string; mime: string }[]>("/api/files", { method: "POST", body: fd });
      setPicked(saved[0]);
      push(`${f.name} ready`, "ok");
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
      ev.target.value = "";
    }
  };

  const openNew = (d?: Date) => {
    setPicked(null);
    const when = d || new Date();
    const at = new Date(when);
    if (d) at.setHours(10, 0, 0, 0);
    setCreating(toLocalInput(at.toISOString()));
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const when = String(fd.get("when") || "");
    const status = String(fd.get("status") || "draft");
    const posted_url = String(fd.get("posted_url") || "").trim();
    if (status === "posted" && !posted_url) return push("Posted needs the live URL as evidence", "bad");
    const creation_id = String(fd.get("creation_id") || "");
    const chosen = creations.find((c) => c.id === creation_id);
    /* An uploaded poster wins over a pick from the wall: it is the more deliberate of the two,
       and it is the one sitting in front of you on the form. */
    const file_id = picked ? picked.id : chosen ? chosen.file_id : undefined;
    const body = {
      platform: fd.get("platform"),
      scheduled_at: when ? new Date(when).toISOString() : undefined,
      caption: fd.get("caption"),
      notes: fd.get("notes"),
      status,
      posted_url,
      creation_id: picked ? "" : creation_id || undefined,
      file_id,
    };
    setBusy(true);
    try {
      if (editing) await postJson("/api/posts", { id: editing.id, ...body }, "PATCH");
      else await postJson("/api/posts", body);
      push(editing ? "Post updated" : "Post planned", "ok");
      setEditing(null);
      setCreating(null);
      setPicked(null);
      await load();
    } catch (err) {
      push((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!editing || !confirm("Delete this post and its metrics?")) return;
    await api(`/api/posts?id=${editing.id}`, { method: "DELETE" });
    setEditing(null);
    load();
  };

  const form = (p: Post | null) => (
    <form onSubmit={save} className="stack">
      <div className="hand-over">
        <div className="ho-pic">
          {picked ? (
            picked.mime.startsWith("video/")
              ? <video className="asset-video" src={fileUrl(picked.id)} controls style={{ aspectRatio: "auto", maxHeight: 170 }} />
              : <img src={fileUrl(picked.id)} alt="" />
          ) : p?.image_file_id && !picked ? (
            <img src={fileUrl(p.image_file_id)} alt="" />
          ) : (
            <span className="muted small">no picture yet</span>
          )}
        </div>
        <div className="ho-body">
          <strong>Hand over a poster</strong>
          <p className="small muted">
            An image or a video straight off your machine — nothing has to go through the studio first.
            It lands in the Library too, so it is findable afterwards.
          </p>
          <div className="actions">
            <label className="btn primary">
              {busy ? "Uploading…" : picked ? "Choose another" : "Choose a file"}
              <input type="file" accept="image/*,video/*" hidden onChange={upload} disabled={busy} />
            </label>
            {picked ? <button className="btn ghost" type="button" onClick={() => setPicked(null)}>Clear</button> : null}
            {picked ? <span className="small muted">{picked.name}</span> : null}
          </div>
        </div>
      </div>
      <div className="form-grid">
        <label className="field"><span>Platform</span><select className="select" name="platform" defaultValue={p?.platform || "Instagram"}>{PLATFORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span>Date and time</span><input className="input" type="datetime-local" name="when" defaultValue={p ? toLocalInput(p.scheduled_at) : creating || ""} required={!p} /></label>
        <label className="field full"><span>…or take one from the wall <em className="muted">only if you have not handed a file over above</em></span>
          <select className="select" name="creation_id" defaultValue={p?.creation_id || ""} disabled={Boolean(picked)}>
            <option value="">None / text only</option>
            {creations.filter((c) => c.status === "approved" || c.id === p?.creation_id).map((c) => <option key={c.id} value={c.id}>{c.title || c.id}{c.status !== "approved" ? ` (${c.status})` : ""}</option>)}
          </select>
        </label>
        <label className="field full"><span>Caption</span><textarea className="textarea" name="caption" rows={5} defaultValue={p?.caption || ""} placeholder="Write it however you like — nothing here is generated unless you ask for it." /></label>
        <label className="field"><span>Status</span>
          <select className="select" name="status" defaultValue={p?.status || "draft"}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field"><span>Live post URL <em className="muted">required for posted</em></span><input className="input" name="posted_url" defaultValue={p?.posted_url || ""} placeholder="https://www.instagram.com/p/…" /></label>
        <label className="field full"><span>Notes</span><input className="input" name="notes" defaultValue={p?.notes || ""} placeholder="Who posts it, hashtags, approvals" /></label>
      </div>
      <div className="note small">Statuses mean: draft (idea), approved (copy and image signed off), scheduled (queued in the platform's own scheduler), posted (live, URL recorded), failed. Circuit never posts on your behalf. The URL is the evidence.</div>
      <div className="actions">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : p ? "Save changes" : "Add post"}</button>
        {p ? <Link className="btn" href={`/analytics?post=${p.id}`}>Record metrics</Link> : null}
        {p ? <button className="btn danger" type="button" onClick={remove}>Delete</button> : null}
      </div>
    </form>
  );

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
          <p className="lede">Plan when each post goes out. Click any day to add one by hand — hand over a poster, write the caption, done. After posting, add the live link.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>Prev</button>
          <button className="btn" type="button" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
          <button className="btn" type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next</button>
          <button className="btn primary" type="button" onClick={() => openNew()}>New post</button>
        </div>
      </div>

      <section className="panel">
        <div className="calendar">
          {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
          {days.map((d) => {
            const evts = posts.filter((p) => sameDay(new Date(p.scheduled_at), d));
            return (
              <div key={d.toISOString()} className={`day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${sameDay(d, today) ? "today" : ""}`}>
                <span className="num">{d.getDate()}</span>
                {/* An empty day is the fastest way in: click it and the form opens on that date. */}
                <button className="day-add" type="button" title={`Add a post on ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`} onClick={() => openNew(d)}>+</button>
                {evts.map((p) => <div key={p.id} className={`evt ${p.status}`} title={`${p.platform}: ${p.caption}`} onClick={() => setEditing(p)}>{new Date(p.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} {p.platform}</div>)}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>This month</h3><Pill>{monthPosts.length} posts</Pill></div>
        {monthPosts.length ? (
          <div className="list">
            {monthPosts.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map((p) => (
              <div key={p.id} className="list-item" onClick={() => setEditing(p)} style={{ cursor: "pointer" }}>
                {p.image_file_id ? <img className="mini" src={fileUrl(p.image_file_id)} alt="" /> : <div className="mini empty">text</div>}
                <div><strong>{p.platform} · {fmtDate(p.scheduled_at)}</strong><p>{p.caption ? p.caption.slice(0, 110) : "No caption yet"}{p.posted_url ? " · URL recorded" : ""}</p></div>
                <Pill tone={statusTone(p.status)}>{p.status}</Pill>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Nothing planned this month" hint="Approve a creation on the Wall and schedule it, or add a post here." />
        )}
      </section>

      {creating ? <Modal title="New post" eyebrow="By hand" onClose={() => { setCreating(null); setPicked(null); }}>{form(null)}</Modal> : null}
      {editing ? <Modal title={`${editing.platform} · ${fmtDate(editing.scheduled_at)}`} onClose={() => { setEditing(null); setPicked(null); }}>
        {editing.image_file_id ? <ViewableImage eyebrow="This post" alt=""
          item={{ id: editing.id, src: fileUrl(editing.image_file_id), title: editing.creation_title || `${editing.platform} post`, subtitle: fmtDate(editing.scheduled_at), body: editing.caption || "" }}
          style={{ maxHeight: 220, marginBottom: 12, border: "1px solid var(--line)" }} /> : null}
        {form(editing)}
      </Modal> : null}
    </div>
  );
}
