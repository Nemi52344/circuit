"use client";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, postJson, fileUrl, fmtDate, PLATFORMS } from "@/lib/api";
import { Pill, Empty, Modal, ViewableImage, useToast, statusTone } from "@/components/ui";
import type { Post, Creation } from "@/lib/types";
import { taggedLink, linkFault } from "@/lib/utm";
import { DAYS } from "@/lib/dates";

type Series = {
  id: string; name: string; platform: string; cadence: "weekly" | "monthly";
  weekday: number; day_of_month: number; at_time: string; caption: string; notes: string;
  active: number; file_id?: string | null; made?: number; next?: string | null;
  ready?: boolean; fault?: string;
};
type LibFile = { id: string; name: string; mime: string; title?: string; kind: string };
const BLANK: Partial<Series> = { name: "", platform: "Instagram", cadence: "weekly", weekday: 4, day_of_month: 1, at_time: "18:30", caption: "" };

const STATUSES = ["draft", "approved", "scheduled", "posted", "failed"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* The Monday on or before a date. Weeks start on Monday here because the posting week does. */
function mondayOf(d: Date) {
  const x = new Date(d);
  x.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

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
  /* One date the whole screen hangs off, rather than a month and a week kept in step by hand.
     The month view reads its month; the week view reads its week. */
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<"month" | "week">("month");
  /* Which post is in the air, so the day under the cursor can light up. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState("");
  const dragging = useRef<string | null>(null);
  /* What the tagged link would be, kept in step as the fields are typed. Built with the same
     function the server uses, so the preview is the link and not an approximation of it. */
  const [link, setLink] = useState({ platform: "Instagram", when: "", url: "", campaign: "", content: "" });
  /* The posts that repeat. Kept beside the calendar because that is where you notice one is
     missing. */
  const [series, setSeries] = useState<Series[]>([]);
  const [editSeries, setEditSeries] = useState<Partial<Series> | null>(null);
  /* The brand's own pictures, for choosing what a series starts each draft with. Loaded only
     when the form opens — it is a list of 60-odd rows nobody needs on the calendar itself. */
  const [lib, setLib] = useState<LibFile[]>([]);
  const [editing, setEditing] = useState<Post | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* A poster handed straight over, rather than made in the studio. Kept beside the form so the
     picture is on screen before anything is saved. */
  const [picked, setPicked] = useState<{ id: string; name: string; mime: string } | null>(null);

  const load = async () => {
    const [p, c, sr] = await Promise.all([
      api<Post[]>("/api/posts"), api<Creation[]>("/api/creations"),
      api<{ series: Series[] }>("/api/series").catch(() => ({ series: [] as Series[] })),
    ]);
    setPosts(p);
    setCreations(c);
    setSeries(sr.series);
    const want = params.get("post");
    if (want) setEditing(p.find((x) => x.id === want) || null);
  };
  useEffect(() => {
    load().catch((e: Error) => push(e.message, "bad"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const month = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1), [anchor]);
  const weekStart = useMemo(() => mondayOf(anchor), [anchor]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; }),
    [weekStart],
  );

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

  const inWeek = (d: Date) => d >= weekStart && d < new Date(weekStart.getTime() + 7 * 86400000);
  const weekPosts = useMemo(() => posts.filter((p) => inWeek(new Date(p.scheduled_at))), [posts, weekStart]);

  /* The hours the week view draws. Seven to nine covers every posting time anybody has used,
     but the band stretches rather than hiding a post that sits outside it — a calendar that
     quietly drops something is worse than one that is a row taller. */
  const hours = useMemo(() => {
    let lo = 7;
    let hi = 21;
    for (const p of weekPosts) {
      const h = new Date(p.scheduled_at).getHours();
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [weekPosts]);

  /* Dragging a post to a new slot.

     The row is moved on screen first and put back if the save fails, because a card that snaps
     back a second later tells you the truth; one that sits in the new place while the database
     disagrees does not. */
  const moveTo = async (postId: string, when: Date) => {
    const p = posts.find((x) => x.id === postId);
    if (!p) return;
    if (p.status === "posted") {
      push("A post that has gone out keeps the date it went out on — that date is the record of when it happened", "bad");
      return;
    }
    const iso = when.toISOString();
    if (iso === p.scheduled_at) return;
    setPosts((ps) => ps.map((x) => (x.id === postId ? { ...x, scheduled_at: iso } : x)));
    try {
      await postJson("/api/posts", { id: postId, scheduled_at: iso }, "PATCH");
      push(`Moved to ${when.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, "ok");
      await load();
    } catch (err) {
      push((err as Error).message, "bad");
      await load();
    }
  };

  /* Dropped on a day: the time of day it already had is kept, because moving a post to Thursday
     is not a statement about what time it should go out. */
  const dropOnDay = (id: string, d: Date) => {
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    const was = new Date(p.scheduled_at);
    const when = new Date(d);
    when.setHours(was.getHours(), was.getMinutes(), 0, 0);
    moveTo(id, when);
  };

  /* Dropped on an hour in the week view: that is a statement about the time, so it is taken. */
  const dropOnHour = (id: string, d: Date, hour: number) => {
    const when = new Date(d);
    when.setHours(hour, 0, 0, 0);
    moveTo(id, when);
  };

  /* Which post is being dragged is carried by the drag itself rather than by React state.

     State was the obvious place for it and the wrong one: the browser fires dragstart and the
     first dragover back to back, and a render does not necessarily land between them, so the
     cell could not know a drag was in progress and refused the drop. The DataTransfer is what
     the browser provides for exactly this, and the ref covers dragover, which has to decide
     whether to accept before the data can be read. */
  const dragProps = (p: Post) => ({
    draggable: p.status !== "posted",
    onDragStart: (e: React.DragEvent) => {
      dragging.current = p.id;
      e.dataTransfer.setData("text/plain", p.id);
      e.dataTransfer.effectAllowed = "move";
      setDragId(p.id);
    },
    onDragEnd: () => { dragging.current = null; setDragId(null); setOver(""); },
  });

  const dropProps = (key: string, drop: (id: string) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver((o) => (o === key ? o : key));
    },
    onDragLeave: () => setOver((o) => (o === key ? "" : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragging.current;
      dragging.current = null;
      setDragId(null);
      setOver("");
      if (id) drop(id);
    },
  });

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
    setLink({ platform: "Instagram", when: (d || new Date()).toISOString(), url: "", campaign: "", content: "" });
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
      link_url: String(fd.get("link_url") || "").trim(),
      utm_campaign: String(fd.get("utm_campaign") || "").trim(),
      utm_content: String(fd.get("utm_content") || "").trim(),
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
  /* Opening a post seeds the preview from it, so the link shown is the one already saved
     rather than a blank that fills in only once something is typed. */
  const openPost = (pst: Post) => {
    setEditing(pst);
    setLink({ platform: pst.platform, when: pst.scheduled_at, url: pst.link_url || "", campaign: pst.utm_campaign || "", content: pst.utm_content || "" });
  };

  const openSeries = async (sr: Partial<Series>) => {
    setEditSeries(sr);
    if (!lib.length) {
      try {
        const all = await api<LibFile[]>("/api/files");
        /* Pictures and video only, and only the brand's own: the library also holds every
           competitor reference Circuit has ever scraped, and none of those are ours to post. */
        setLib(all.filter((f) => /^(image|video)\//.test(f.mime) && ["product", "upload", "generated"].includes(f.kind)));
      } catch { /* the picker is a convenience; the form still works without it */ }
    }
  };

  const saveSeries = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      id: editSeries?.id,
      file_id: editSeries?.file_id || "",
      name: String(fd.get("name") || ""),
      platform: String(fd.get("platform") || "Instagram"),
      cadence: String(fd.get("cadence") || "weekly"),
      weekday: Number(fd.get("weekday") || 4),
      day_of_month: Number(fd.get("day_of_month") || 1),
      at_time: String(fd.get("at_time") || "18:30"),
      caption: String(fd.get("caption") || ""),
      notes: String(fd.get("notes") || ""),
    };
    setBusy(true);
    try {
      await postJson("/api/series", body, body.id ? "PATCH" : "POST");
      push(body.id ? "Series saved" : "Series added — press “Put it on the calendar” to schedule it", "ok");
      setEditSeries(null);
      await load();
    } catch (err) { push((err as Error).message, "bad"); } finally { setBusy(false); }
  };

  const fillSeries = async (id?: string) => {
    setBusy(true);
    try {
      const r = await postJson<{ filled: { series: string; added: number; skipped: number; refused?: string }[] }>("/api/series", { action: "fill", weeks: 8, id });
      const added = r.filled.reduce((a, f) => a + f.added, 0);
      const skipped = r.filled.reduce((a, f) => a + f.skipped, 0);
      const refused = r.filled.filter((f) => f.refused);
      if (refused.length) {
        push(`${refused.map((f) => f.series).join(", ")} left alone — ${refused[0].refused}`, "bad");
      }
      if (added || !refused.length) {
        push(added
          ? `${added} post${added > 1 ? "s" : ""} added over the next 8 weeks${skipped ? ` · ${skipped} already there` : ""}`
          : "Already up to date — nothing to add", added ? "ok" : "");
      }
      await load();
    } catch (err) { push((err as Error).message, "bad"); } finally { setBusy(false); }
  };

  const dropSeries = async (sr: Series) => {
    if (!confirm(`Stop "${sr.name}" repeating? The ${sr.made || 0} post(s) it already made stay on the calendar.`)) return;
    try {
      const r = await api<{ kept: number }>(`/api/series?id=${sr.id}`, { method: "DELETE" });
      push(`Series removed — ${r.kept} post${r.kept === 1 ? "" : "s"} left on the calendar`, "ok");
      await load();
    } catch (err) { push((err as Error).message, "bad"); }
  };

  const whenItFalls = (sr: Series) =>
    sr.cadence === "weekly"
      ? `every ${DAYS[sr.weekday]} at ${sr.at_time}`
      : `the ${sr.day_of_month}${[, "st", "nd", "rd"][sr.day_of_month % 10 > 3 || (sr.day_of_month >= 11 && sr.day_of_month <= 13) ? 0 : sr.day_of_month % 10] || "th"} of each month at ${sr.at_time}`;

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
        <label className="field"><span>Platform</span><select className="select" name="platform" defaultValue={p?.platform || "Instagram"} onChange={(e) => setLink((l) => ({ ...l, platform: e.target.value }))}>{PLATFORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span>Date and time</span><input className="input" type="datetime-local" name="when" defaultValue={p ? toLocalInput(p.scheduled_at) : creating || ""} required={!p} onChange={(e) => setLink((l) => ({ ...l, when: e.target.value ? new Date(e.target.value).toISOString() : l.when }))} /></label>
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

      {/* Where the post sends people, and the tagged version of that link.

          Source and medium are not fields: they follow from the platform, and letting anybody
          type "insta" once would split a campaign into two in the analytics for good. */}
      <div className="form-grid">
        <label className="field full"><span>Link to the website <em className="muted">optional — the page this post sends people to</em></span>
          <input className="input" name="link_url" defaultValue={p?.link_url || ""} placeholder="https://bncmotors.in/challenger"
            onChange={(e) => setLink((l) => ({ ...l, url: e.target.value }))} />
        </label>
        <label className="field"><span>Campaign <em className="muted">defaults to the month</em></span>
          <input className="input" name="utm_campaign" defaultValue={p?.utm_campaign || ""} placeholder="festive-offer"
            onChange={(e) => setLink((l) => ({ ...l, campaign: e.target.value }))} />
        </label>
        <label className="field"><span>Which piece <em className="muted">optional</em></span>
          <input className="input" name="utm_content" defaultValue={p?.utm_content || ""} placeholder="reel-one"
            onChange={(e) => setLink((l) => ({ ...l, content: e.target.value }))} />
        </label>
      </div>
      {(() => {
        const raw = link.url || p?.link_url || "";
        const fault = linkFault(raw);
        if (!raw.trim()) return null;
        if (fault) return <div className="note warn small">{fault}</div>;
        const built = taggedLink({
          platform: link.platform || p?.platform || "Instagram",
          scheduled_at: link.when || p?.scheduled_at || new Date().toISOString(),
          link_url: raw,
          utm_campaign: link.campaign || p?.utm_campaign || "",
          utm_content: link.content || p?.utm_content || "",
        });
        return (
          <div className="note small stack" style={{ gap: 6 }}>
            <strong>Put this link in the post</strong>
            <code className="tagged">{built}</code>
            <div className="actions">
              <button className="btn small" type="button" onClick={() => { navigator.clipboard?.writeText(built); push("Link copied", "ok"); }}>Copy</button>
            </div>
          </div>
        );
      })()}
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
          <h1>{mode === "month"
            ? month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
            : `${weekStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}</h1>
          <p className="lede">
            Plan when each post goes out. Click any day to add one by hand, or drag a post to move it —
            {mode === "month" ? " the month keeps its time of day" : " the week sets the hour you drop it on"}.
            After posting, add the live link.
          </p>
        </div>
        <div className="actions">
          {/* Two ways of looking at the same posts: the month for shape, the week for time of day. */}
          <div className="seg" role="group" aria-label="How to show the calendar">
            <button className={`seg-btn ${mode === "month" ? "on" : ""}`} type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
            <button className={`seg-btn ${mode === "week" ? "on" : ""}`} type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>Week</button>
          </div>
          <button className="btn" type="button" aria-label={mode === "month" ? "Previous month" : "Previous week"}
            onClick={() => setAnchor((a) => (mode === "month" ? new Date(a.getFullYear(), a.getMonth() - 1, 1) : new Date(a.getTime() - 7 * 86400000)))}>Prev</button>
          <button className="btn" type="button" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="btn" type="button" aria-label={mode === "month" ? "Next month" : "Next week"}
            onClick={() => setAnchor((a) => (mode === "month" ? new Date(a.getFullYear(), a.getMonth() + 1, 1) : new Date(a.getTime() + 7 * 86400000)))}>Next</button>
          <button className="btn primary" type="button" onClick={() => openNew()}>New post</button>
        </div>
      </div>

      <section className="panel">
        {mode === "month" ? (
          <div className="calendar">
            {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
            {days.map((d) => {
              const key = d.toISOString();
              const evts = posts.filter((p) => sameDay(new Date(p.scheduled_at), d));
              return (
                <div key={key}
                  className={`day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${sameDay(d, today) ? "today" : ""} ${over === key ? "drop" : ""}`}
                  {...dropProps(key, (id) => dropOnDay(id, d))}
                >
                  <span className="num">{d.getDate()}</span>
                  {/* An empty day is the fastest way in: click it and the form opens on that date. */}
                  <button className="day-add" type="button" title={`Add a post on ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`} onClick={() => openNew(d)}>+</button>
                  {evts.map((p) => (
                    <div key={p.id} className={`evt ${p.status} ${dragId === p.id ? "dragging" : ""}`}
                      title={`${p.platform}: ${p.caption}${p.status === "posted" ? "" : " — drag to move it"}`}
                      onClick={() => openPost(p)} {...dragProps(p)}
                    >
                      {new Date(p.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} {p.platform}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="weekgrid" style={{ ["--wg-rows" as string]: hours.length }}>
            <div className="wg-corner" />
            {weekDays.map((d) => (
              <div key={d.toISOString()} className={`wg-dayhead ${sameDay(d, today) ? "today" : ""}`}>
                <span className="muted small">{DOW[(d.getDay() + 6) % 7]}</span>
                <strong>{d.getDate()} {d.toLocaleDateString("en-IN", { month: "short" })}</strong>
              </div>
            ))}
            {hours.map((h) => (
              <Fragment key={h}>
                <div className="wg-hour">{String(h).padStart(2, "0")}:00</div>
                {weekDays.map((d) => {
                  const key = `${d.toISOString()}-${h}`;
                  const cell = posts.filter((p) => { const t = new Date(p.scheduled_at); return sameDay(t, d) && t.getHours() === h; });
                  const when = new Date(d);
                  when.setHours(h, 0, 0, 0);
                  return (
                    <div key={key}
                      className={`wg-cell ${when < today && !sameDay(d, today) ? "past" : ""} ${over === key ? "drop" : ""}`}
                      onDoubleClick={() => { setPicked(null); setCreating(toLocalInput(when.toISOString())); }}
                      title={cell.length ? undefined : `Double-click to add a post at ${String(h).padStart(2, "0")}:00`}
                      {...dropProps(key, (id) => dropOnHour(id, d, h))}
                    >
                      {cell.map((p) => (
                        <div key={p.id} className={`evt wk ${p.status} ${dragId === p.id ? "dragging" : ""}`}
                          title={`${p.platform}: ${p.caption}${p.status === "posted" ? "" : " — drag to move it"}`}
                          onClick={() => openPost(p)} {...dragProps(p)}
                        >
                          {/* The row already says the hour, so the minutes are what this adds. Two
                              lines on purpose, rather than one line wrapping where it happens to. */}
                          <small>{new Date(p.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
                          <span>{p.platform}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )}
        {/* Dragging is a mouse. The date field in the post itself is the way that is not, and it
            is the same change either way. */}
        <p className="small muted" style={{ marginTop: 10 }}>
          A post that has gone out cannot be dragged — its date is the record of when it happened.
          Everything else moves; to move one without a mouse, open it and change the date.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>This month</h3><Pill>{monthPosts.length} posts</Pill></div>
        {monthPosts.length ? (
          <div className="list">
            {monthPosts.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map((p) => (
              <div key={p.id} className="list-item" onClick={() => openPost(p)} style={{ cursor: "pointer" }}>
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

      {/* ---- the posts that repeat ---- */}
      <section className="panel stack">
        <div className="panel-head">
          <h3>Repeating posts</h3>
          <span className="actions">
            {series.some((x) => x.active) ? (
              <button className="btn small" type="button" disabled={busy} onClick={() => fillSeries()}
                title="Adds the next eight weeks. Safe to press twice — it never writes a second post where one already is.">
                Put the next 8 weeks on the calendar
              </button>
            ) : null}
            <button className="btn small primary" type="button" onClick={() => openSeries({ ...BLANK })}>Add a series</button>
          </span>
        </div>
        {series.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Series</th><th>Platform</th><th>When</th><th>Made</th><th>Next</th><th /></tr></thead>
              <tbody>
                {series.map((sr) => (
                  <tr key={sr.id} className={sr.active ? "" : "set-aside"}>
                    <td>
                      <span className="sr-name">
                        {sr.file_id ? <img className="sr-pic" src={fileUrl(sr.file_id)} alt=""
                          onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /> : null}
                        <span>
                          <strong>{sr.name}</strong>
                          {sr.caption ? <div className="small muted">{sr.caption.slice(0, 60)}</div> : null}
                          {/* Checked on every read, because a picture can be deleted from the
                              library long after the series pointing at it was set up. */}
                          {sr.fault ? <div className="small bad-text">{sr.fault}</div> : null}
                        </span>
                      </span>
                    </td>
                    <td>{sr.platform}</td>
                    <td>{whenItFalls(sr)}</td>
                    <td>{sr.made || "—"}</td>
                    <td>{sr.next ? fmtDate(sr.next) : <span className="muted">nothing ahead</span>}</td>
                    <td>
                      <span className="actions">
                        <button className="btn small ghost" type="button" onClick={() => openSeries(sr)}>Edit</button>
                        <button className="btn small ghost" type="button" disabled={busy} onClick={() => fillSeries(sr.id)}>Fill</button>
                        <button className="btn small ghost" type="button" onClick={() => dropSeries(sr)}>Remove</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nothing repeats yet"
            hint="A reel every Thursday, a dealer post on the first of the month — set it once here and Circuit puts the drafts on the calendar." />
        )}
      </section>

      {editSeries ? (
        <Modal title={editSeries.id ? editSeries.name || "Series" : "A post that repeats"} eyebrow="Repeating"
          onClose={() => setEditSeries(null)}>
          <form onSubmit={saveSeries} className="stack">
            <div className="form-grid">
              <label className="field"><span>What it is</span>
                <input className="input" name="name" required defaultValue={editSeries.name || ""} placeholder="Thursday reel" />
              </label>
              <label className="field"><span>Platform</span>
                <select className="select" name="platform" defaultValue={editSeries.platform || "Instagram"}>{PLATFORMS.map((x) => <option key={x}>{x}</option>)}</select>
              </label>
              <label className="field"><span>How often</span>
                <select className="select" name="cadence" defaultValue={editSeries.cadence || "weekly"}
                  onChange={(e) => setEditSeries((x) => ({ ...x, cadence: e.target.value as Series["cadence"] }))}>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
              {(editSeries.cadence || "weekly") === "weekly" ? (
                <label className="field"><span>On</span>
                  <select className="select" name="weekday" defaultValue={String(editSeries.weekday ?? 4)}>
                    {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
              ) : (
                <label className="field"><span>On the</span>
                  <input className="input" name="day_of_month" type="number" min={1} max={31} defaultValue={editSeries.day_of_month ?? 1} />
                  <span className="small muted">A month that is too short uses its last day rather than skipping.</span>
                </label>
              )}
              <label className="field"><span>At</span>
                <input className="input" name="at_time" type="time" defaultValue={editSeries.at_time || "18:30"} />
              </label>
              <div className="field full">
                <span>The picture every draft starts with</span>
                <div className="pick">
                  <div className="pick-now">
                    {editSeries.file_id
                      ? <img src={fileUrl(editSeries.file_id)} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      : <span className="pick-none">no picture — each draft starts blank</span>}
                  </div>
                  <div className="pick-list">
                    {lib.length ? (
                      <>
                        <div className="pick-grid">
                          {lib.slice(0, 40).map((f) => (
                            <button key={f.id} type="button"
                              className={`pick-item ${editSeries.file_id === f.id ? "on" : ""}`}
                              title={f.title || f.name}
                              onClick={() => setEditSeries((x) => ({ ...x, file_id: x?.file_id === f.id ? null : f.id }))}>
                              {f.mime.startsWith("video/")
                                ? <span className="pick-vid">video</span>
                                : <img src={fileUrl(f.id)} alt="" loading="lazy" />}
                            </button>
                          ))}
                        </div>
                        <div className="actions">
                          {editSeries.file_id
                            ? <button className="btn small ghost" type="button" onClick={() => setEditSeries((x) => ({ ...x, file_id: null }))}>Use no picture</button>
                            : null}
                          <label className="btn small">
                            {busy ? "Uploading…" : "Upload another"}
                            <input type="file" accept="image/*,video/*" hidden disabled={busy}
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (!f) return;
                                const fd2 = new FormData();
                                fd2.append("files", f);
                                fd2.append("kind", "upload");
                                fd2.append("brand", "1");
                                setBusy(true);
                                try {
                                  const saved = await api<LibFile[]>("/api/files", { method: "POST", body: fd2 });
                                  setLib((l) => [saved[0], ...l]);
                                  setEditSeries((x) => ({ ...x, file_id: saved[0].id }));
                                  push(`${f.name} ready`, "ok");
                                } catch (err) { push((err as Error).message, "bad"); } finally { setBusy(false); }
                              }} />
                          </label>
                        </div>
                      </>
                    ) : <span className="small muted">Nothing in the library yet. Upload a picture and it is used for every draft this series makes.</span>}
                  </div>
                </div>
              </div>

              <label className="field full"><span>Caption to start from <em className="muted">optional</em></span>
                <textarea className="textarea" name="caption" rows={3} defaultValue={editSeries.caption || ""}
                  placeholder="Every draft starts with this. Edit each one as you go." />
              </label>
              <label className="field full"><span>Notes</span>
                <input className="input" name="notes" defaultValue={editSeries.notes || ""} placeholder="Who shoots it, what it usually covers" />
              </label>
            </div>
            <div className="note small">
              Each date becomes an ordinary draft. Move it, rewrite it or delete it and the series will not put it back.
            </div>
            <div className="actions">
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : editSeries.id ? "Save" : "Add series"}</button>
              <button className="btn ghost" type="button" onClick={() => setEditSeries(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      ) : null}

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
