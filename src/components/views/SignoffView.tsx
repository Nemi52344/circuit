"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fileUrl } from "@/lib/api";
import { useToast, Empty } from "@/components/ui";
import { can } from "@/lib/roles";
import { useMe } from "@/components/Gate";

/* Sign-off: somebody who can approve reading what is about to go public, and saying yes or no.

   Everything here is one question — would you be happy for this to be seen? So the caption is
   shown in full, at the size it will be read at, beside the picture that goes with it. No
   truncation and no hover-to-expand: an approval given to an ellipsis is not an approval. */

type State = {
  id: string; platform: string; caption: string; scheduled_at: string; image: string | null;
  signoff: { decision: string; by_name: string; note: string; decided_at: string } | null;
  stale: boolean; cleared: boolean; blocked_reason: string;
};

export default function SignoffPage() {
  const { me } = useMe();
  const [d, setD] = useState<{ waiting: State[]; cleared: State[]; stale: number } | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const { push, view } = useToast();

  const load = useCallback(() => api<typeof d>("/api/signoff").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id);
    try {
      await postJson("/api/signoff", { id, decision, note: note[id] || "" });
      setNote((n) => ({ ...n, [id]: "" }));
      push(decision === "approved" ? "Signed off" : "Sent back", "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  if (!d) return <p className="muted">Loading…</p>;
  const admin = can(me, "approve");

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Sign-off</h2>
          <p className="lede">
            Nothing goes public until somebody who can approve says so. An approval covers the words that were read — edit a post after
            it is signed off and it comes back here, because the yes was for the old version.
          </p>
        </div>
      </div>

      {!admin ? (
        <p className="note small">
          You can see what is waiting, but your account cannot sign posts off — an owner, a manager or an approver can.
        </p>
      ) : null}

      {d.stale > 0 ? (
        <p className="note bad small">
          {d.stale} {d.stale === 1 ? "post was" : "posts were"} edited after being signed off, so {d.stale === 1 ? "it needs" : "they need"} looking at again.
        </p>
      ) : null}

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3>Waiting</h3>
          <span className="small muted">{d.waiting.length}</span>
        </div>
        {d.waiting.length === 0
          ? <Empty title="Nothing is waiting" hint="Everything scheduled has been signed off." />
          : d.waiting.map((p) => (
            <article key={p.id} className="panel stack" style={{ padding: 16 }}>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <strong>{p.platform}</strong>
                <span className="small muted">{p.scheduled_at.slice(0, 10)}{p.stale ? " · edited since sign-off" : ""}</span>
              </div>
              <div className="signoff-body">
                {p.image ? <img className="signoff-img" src={fileUrl(p.image)} alt="" /> : <span className="small muted">No picture</span>}
                <p className="signoff-caption">{p.caption || <span className="muted">No caption written yet.</span>}</p>
              </div>
              {p.signoff?.decision === "rejected" ? (
                <p className="note bad small" style={{ margin: 0 }}>
                  Sent back by {p.signoff.by_name}: {p.signoff.note}
                </p>
              ) : null}
              {admin ? (
                <>
                  <input className="input" placeholder="What needs changing? (required to send back)" aria-label="What needs changing before this can go out"
                    value={note[p.id] || ""} onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))} />
                  <span className="actions">
                    <button className="btn primary small" type="button" disabled={busy === p.id} onClick={() => decide(p.id, "approved")}>Sign off</button>
                    <button className="btn small ghost" type="button" disabled={busy === p.id} onClick={() => decide(p.id, "rejected")}>Send back</button>
                  </span>
                </>
              ) : null}
            </article>
          ))}
      </section>

      {d.cleared.length ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Cleared to go out</h3>
            <span className="small muted">{d.cleared.length}</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Platform</th><th>Scheduled</th><th>Signed off by</th><th>When</th></tr></thead>
              <tbody>
                {d.cleared.map((p) => (
                  <tr key={p.id}>
                    <td className="strong">{p.platform}</td>
                    <td className="muted">{p.scheduled_at.slice(0, 10)}</td>
                    <td>{p.signoff?.by_name}</td>
                    <td className="muted">{p.signoff?.decided_at.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
