"use client";
import { useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/api";

/* After something is made in the Studio: put it on the calendar as a post. One box for an
   image and for a carousel alike — the pictures go in the order given. Posters then wait for
   sign-off on Content status; nothing is published until somebody presses Publish there. */

const PLATFORMS = ["Instagram", "Facebook", "LinkedIn"];
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

export function ScheduleBox({ fileIds, title, push, defaultCaption = "" }: { fileIds: string[]; title: string; push: (t: string, tone?: string) => void; defaultCaption?: string }) {
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("18:00");
  const [platforms, setPlatforms] = useState<string[]>(["Instagram"]);
  const [caption, setCaption] = useState(defaultCaption);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const schedule = async () => {
    setBusy(true);
    try {
      await postJson("/api/content", { action: "schedule", file_ids: fileIds, caption, date, time, platforms, title });
      setDone(true);
      push(`On the calendar for ${date} — it waits for sign-off on Content status`, "ok");
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  if (done) return <div className="note ok small">Scheduled for {date} at {time} on {platforms.join(", ")}. <Link href="/content" style={{ textDecoration: "underline" }}>See it on Content status</Link> — the manager signs posters off there.</div>;
  return (
    <div className="sched-box">
      <strong className="small">Put it on the calendar</strong>
      <div className="wk-chips">
        {PLATFORMS.map((p) => {
          const on = platforms.includes(p);
          return <button key={p} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setPlatforms(on ? platforms.filter((x) => x !== p) : [...platforms, p])}>{p}</button>;
        })}
      </div>
      <div className="wk-drawer-grid">
        <label className="field"><span>Day</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Time</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      <label className="field"><span>Caption</span><textarea className="textarea" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What the post says under the picture" /></label>
      <button type="button" className="btn primary" disabled={busy || !platforms.length} onClick={schedule}>{busy ? "Scheduling…" : fileIds.length > 1 ? `Schedule the ${fileIds.length}-slide carousel` : "Schedule it"}</button>
    </div>
  );
}
