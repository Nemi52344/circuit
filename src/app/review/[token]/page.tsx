"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, postJson, fileUrl } from "@/lib/api";
import { FORMAT_LABEL, niceDate } from "@/lib/slotui";

type Review = {
  approver: { name: string; role: string };
  status: "pending" | "approved" | "changes"; comment: string; decided_at: string; stale: boolean;
  post: { topic: string; date: string; time: string; format: string; pillar: string | null; image_file_id: string | null; platforms: string[] };
  content: { platform: string; caption: string; hashtags: string; title: string; link: string }[];
};

/* The page one approver opens from their personal link: look, then approve or ask for changes. */
export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [r, setR] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<Review>(`/api/review/${token}`).then((x) => { setR(x); setComment((c) => c || x.comment); }).catch((e: Error) => setErr(e.message)), [token]);
  useEffect(() => { load(); }, [load]);

  const decide = async (status: "approved" | "changes") => {
    if (status === "changes" && !comment.trim()) return setMsg("Say what should change first.");
    setBusy(true);
    setMsg("");
    try {
      await postJson(`/api/review/${token}`, { status, comment });
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <div className="note bad"><strong>Can&apos;t open this review</strong>{err}</div>;
  if (!r) return <p className="muted">Loading…</p>;
  const decided = r.status !== "pending";
  return (
    <div className="stack review">
      <div className="page-head">
        <div>
          <p className="small muted" style={{ margin: 0 }}>Review for {r.approver.name}{r.approver.role ? `, ${r.approver.role}` : ""}</p>
          <h2>{r.post.topic}</h2>
          <p className="lede">{niceDate(r.post.date)} at {r.post.time} · {FORMAT_LABEL[r.post.format] || r.post.format} · {r.post.platforms.join(", ")}</p>
        </div>
      </div>

      {r.stale ? <div className="note bad"><strong>This post has changed since this link was sent</strong>Ask for a new review link so you approve what will actually go out.</div> : null}
      {decided && !r.stale ? (
        <div className={`note ${r.status === "approved" ? "ok" : "bad"}`}>
          <strong>{r.status === "approved" ? "You approved this post" : "You asked for changes"}</strong>
          {r.comment ? <>&ldquo;{r.comment}&rdquo; </> : null}You can change your answer below until it&apos;s scheduled.
        </div>
      ) : null}

      <div className="review-grid">
        {r.post.image_file_id ? <a href={fileUrl(r.post.image_file_id)} target="_blank" rel="noreferrer" className="review-img"><img src={fileUrl(r.post.image_file_id)} alt="The image that will be posted" /></a> : <div className="review-img empty">Text-only post</div>}
        <div className="stack" style={{ gap: 12 }}>
          {r.content.map((c) => (
            <section key={c.platform} className="panel" style={{ padding: "14px 16px" }}>
              <h4 className="learned-h">{c.platform}</h4>
              {c.title ? <p style={{ fontWeight: 600, margin: "0 0 6px" }}>{c.title}</p> : null}
              <p className="review-caption">{c.caption}</p>
              {c.hashtags ? <p className="small muted" style={{ margin: "6px 0 0" }}>{c.hashtags}</p> : null}
              {c.link ? <p className="small" style={{ margin: "6px 0 0" }}>Link: {c.link}</p> : null}
            </section>
          ))}
        </div>
      </div>

      {!r.stale ? (
        <section className="panel stack">
          <label className="field"><span>Comment <em>needed if you ask for changes</em></span>
            <textarea className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="For example: use the side view of the bike, and remove the word 'cheapest'" />
          </label>
          {msg ? <div className="note bad">{msg}</div> : null}
          <div className="actions">
            <button className="btn primary big" type="button" disabled={busy} onClick={() => decide("approved")}>Approve</button>
            <button className="btn big" type="button" disabled={busy} onClick={() => decide("changes")}>Request changes</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
