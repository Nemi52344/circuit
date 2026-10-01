"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fileUrl, downloadUrl, fmtDate } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";
import { PlatformMark } from "@/components/Platform";
import { Tabs } from "@/components/Sheet";
import type { Ready } from "@/app/api/posting/route";

/* The hand-over.

   Instagram and Facebook can be published to properly, through the Meta app Circuit already
   holds. LinkedIn and X cannot: LinkedIn only gives that power to approved partners and X now
   charges for the API. So for those two the honest answer is a page that makes posting by hand
   take thirty seconds — the picture ready to save, the words ready to copy, and one box for the
   link afterwards, because a post with no link recorded may as well not have happened. */

type Data = { ready: Ready[]; late: number; today: string };

const WHERE: Record<string, string> = {
  Instagram: "https://www.instagram.com/",
  Facebook: "https://www.facebook.com/",
  LinkedIn: "https://www.linkedin.com/company/",
  X: "https://x.com/compose/post",
  Blog: "",
};

export default function PostingPage() {
  const [d, setD] = useState<Data | null>(null);
  const [scope, setScope] = useState("due");
  const [busy, setBusy] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>(`/api/posting?${scope === "all" ? "all=1" : "days=7"}`).then(setD)
    .catch((e: Error) => push(e.message, "bad")), [push, scope]);
  useEffect(() => { load(); }, [load]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); push(`${what} copied`, "ok"); }
    catch { push("Could not reach the clipboard — select it by hand", "bad"); }
  };

  const markPosted = async (r: Ready) => {
    const url = (urls[r.id] || "").trim();
    if (!url) { push("Paste the live link first", "bad"); return; }
    setBusy(r.id);
    try {
      await postJson("/api/posting", { id: r.id, posted_url: url });
      push(`${r.platform} marked posted`, "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  if (!d) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Posting</h2>
          <p className="lede">
            Everything ready to go out, with the picture and the words to hand. Paste the live link
            back when it is up — without it there is no evidence the post exists and nothing to
            hang its numbers on later.
          </p>
        </div>
        <Tabs
          tabs={[{ key: "due", label: "Due now", count: d.ready.length }, { key: "all", label: "Everything waiting" }]}
          active={scope} onPick={setScope}
        />
      </div>

      {d.late ? (
        <p className="small" style={{ margin: 0, color: "#A6462F" }}>
          {d.late} {d.late === 1 ? "post is" : "posts are"} past their date.
        </p>
      ) : null}

      {d.ready.length ? (
        <div className="stack" style={{ gap: 14 }}>
          {d.ready.map((r) => (
            <section key={r.id} className={`panel post-out ${r.late ? "late" : ""}`}>
              <div className="po-pic">
                {r.image_file_id
                  ? <img src={fileUrl(r.image_file_id)} alt="" />
                  : <span className="muted small">no picture</span>}
              </div>
              <div className="po-body stack" style={{ gap: 10 }}>
                <div className="fact-top">
                  <PlatformMark name={r.platform} />
                  <strong>{r.topic || r.platform}</strong>
                  <span className="small muted">{fmtDate(r.when)}</span>
                  {r.late ? <Pill tone="bad">late</Pill> : <Pill>{r.status}</Pill>}
                </div>

                <label className="field">
                  <span>The caption <em className="muted">edit it here if you want</em></span>
                  <textarea className="textarea" rows={4} defaultValue={r.caption}
                    onBlur={(e) => e.target.value !== r.caption && postJson("/api/posting", { id: r.id, caption: e.target.value }).then(load)} />
                </label>

                <div className="actions">
                  <button className="btn small primary" type="button" onClick={() => copy(r.caption, "Caption")}>Copy the caption</button>
                  {r.image_file_id ? (
                    <button className="btn small" type="button"
                      onClick={() => downloadUrl(fileUrl(r.image_file_id as string), `${r.platform}-${r.when.slice(0, 10)}.jpg`)}>Save the picture</button>
                  ) : null}
                  {WHERE[r.platform] ? <a className="btn small ghost" href={WHERE[r.platform]} target="_blank" rel="noreferrer">Open {r.platform} ↗</a> : null}
                </div>

                <div className="po-done">
                  <input className="input" placeholder="Paste the live link once it is up…"
                    value={urls[r.id] || ""} onChange={(e) => setUrls({ ...urls, [r.id]: e.target.value })} />
                  <button className="btn" type="button" disabled={busy === r.id} onClick={() => markPosted(r)}>
                    {busy === r.id ? "Saving…" : "It is up"}
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title={scope === "due" ? "Nothing due in the next seven days" : "Nothing waiting"}
          hint="Approved posts with a date appear here when their day comes round." />
      )}
    </div>
  );
}
