"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, postJson, fmtDate } from "@/lib/api";

/* The bell: what needs you, said as it happens.

   Asks for anything new every fifteen seconds. Each new one appears as a pop-up in the corner
   for a few seconds, and — once the person has said yes — as a desktop or phone notification too,
   so it reaches them when Circuit is in a background tab. The bell keeps the list; opening an
   item takes you to where it is about and marks it read. */

type Note = { id: string; kind: string; title: string; body: string; link: string; created_at: string; read_at: string };
const EVERY_MS = 15000;

export function Bell() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [popups, setPopups] = useState<Note[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | "none">("none");
  const newest = useRef<string>("");
  const first = useRef(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);

  const poll = useCallback(async () => {
    try {
      const r = await api<{ notes: Note[]; unread: number }>("/api/notifications");
      setNotes(r.notes);
      setUnread(r.unread);
      const top = r.notes[0]?.created_at || "";
      /* The first load is the backlog, not news: it fills the bell without a burst of pop-ups. */
      if (!first.current && top && top > newest.current) {
        const fresh = r.notes.filter((n) => n.created_at > newest.current && !n.read_at);
        setPopups((p) => [...fresh.slice(0, 3), ...p].slice(0, 4));
        fresh.slice(0, 3).forEach((n) => setTimeout(() => setPopups((p) => p.filter((x) => x.id !== n.id)), 8000));
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          for (const n of fresh.slice(0, 3)) {
            try { new Notification(n.title, { body: n.body, tag: n.id }); } catch { /* some browsers refuse outside a service worker */ }
          }
        }
      }
      if (top > newest.current) newest.current = top;
      first.current = false;
    } catch { /* signed out, or the server is restarting — the next poll tries again */ }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, EVERY_MS);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const go = async (n: Note) => {
    setOpen(false);
    setPopups((p) => p.filter((x) => x.id !== n.id));
    if (!n.read_at) { await postJson("/api/notifications", { ids: [n.id] }).catch(() => null); poll(); }
    if (n.link) router.push(n.link);
  };
  const readAll = async () => { await postJson("/api/notifications", { all: true }).catch(() => null); poll(); };
  const allow = async () => { if (typeof Notification !== "undefined") setPerm(await Notification.requestPermission()); };

  return (
    <>
      <div className="bell" ref={box}>
        <button className="tb-btn" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" /><path d="M6.5 14a1.6 1.6 0 0 0 3 0" />
          </svg>
          {unread ? <span className="bell-count">{unread > 9 ? "9+" : unread}</span> : null}
        </button>
        {open ? (
          <div className="bell-panel" role="dialog" aria-label="Notifications">
            <div className="bell-head">
              <strong>Notifications</strong>
              {unread ? <button className="btn small ghost" type="button" onClick={readAll}>Mark all read</button> : null}
            </div>
            {perm === "default" ? (
              <button className="bell-allow" type="button" onClick={allow}>Also show these as desktop / phone notifications</button>
            ) : null}
            {notes.length ? notes.map((n) => (
              <button key={n.id} type="button" className={`bell-item ${n.read_at ? "" : "unread"}`} onClick={() => go(n)}>
                <span className="bell-title">{n.title}</span>
                {n.body ? <span className="bell-body">{n.body}</span> : null}
                <span className="bell-when">{fmtDate(n.created_at)}</span>
              </button>
            )) : <p className="small muted" style={{ padding: "10px 14px" }}>Nothing yet. Work given to you, routines waiting on you, and things due will appear here.</p>}
          </div>
        ) : null}
      </div>
      {popups.length ? (
        <div className="popups" aria-live="polite">
          {popups.map((n) => (
            <button key={n.id} type="button" className="popup" onClick={() => go(n)}>
              <span className="bell-title">{n.title}</span>
              {n.body ? <span className="bell-body">{n.body}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
