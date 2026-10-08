"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { useToast } from "@/components/ui";

/* The hand-over to Mark, with what it gives away written on the face of it.

   Circuit publishes to Instagram and the Facebook page itself. LinkedIn and X it cannot:
   LinkedIn only lets approved partner apps post, and X charges per post. Mark — the ChatGPT
   dot — has a browser already signed in to both, so this is the door it comes through.

   The two lists below are not reassurance, they are the specification. An endpoint reachable
   from outside this Mac should be readable at a glance by the person who owns the Mac. */

type State = { on: boolean; platforms: string[]; waiting: number; exposes: string[]; withholds: string[] };

export function HandoffPanel() {
  const [s, setS] = useState<State | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();

  const load = useCallback(() => api<State>("/api/handoff").then(setS).catch(() => null), []);
  useEffect(() => { load(); }, [load]);

  const turnOn = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ key: string }>("/api/handoff", { action: "on" });
      setKey(r.key);
      push("Key made. Copy it now — it is not shown again.", "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  const turnOff = async () => {
    if (!confirm("Switch the hand-over off? Mark will stop being able to reach Circuit, and the current key stops working.")) return;
    setBusy(true);
    try { await postJson("/api/handoff", { action: "off" }); setKey(""); load(); }
    finally { setBusy(false); }
  };

  if (!s) return null;

  return (
    <section className="stack">
      {view}
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Hand-over to Mark</h3>
        <span className={`pill ${s.on ? "pill-on" : ""}`}>{s.on ? "On" : "Off"}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Circuit posts to Instagram and the Facebook page itself. It cannot post to {s.platforms.join(" or ")} — LinkedIn only
        allows approved partner apps, and X charges per post. Mark has a browser signed in to both, so Circuit hands it the
        work one post at a time and keeps the record. {s.waiting > 0 ? `${s.waiting} waiting.` : ""}
      </p>

      <div className="grid-2">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Mark can see</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {s.exposes.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Mark cannot see</div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {s.withholds.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      </div>

      {key ? (
        <div className="panel" style={{ padding: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Your key — shown once</div>
          <p className="mono small" style={{ wordBreak: "break-all", margin: "0 0 8px" }}>{key}</p>
          <button className="btn" type="button"
            onClick={() => navigator.clipboard?.writeText(key).then(() => push("Copied", "ok")).catch(() => push("Select it by hand", "bad"))}>
            Copy key
          </button>
        </div>
      ) : null}

      <p className="small muted" style={{ margin: 0 }}>
        {/* Said plainly, because it is the part that is easy to skip and expensive to get wrong. */}
        This only works while Circuit can be reached from the internet, which it cannot be today — it runs on this Mac at
        localhost. Mark runs on OpenAI&apos;s computer, so a tunnel has to point at this machine before any of it does
        anything. Turn this on when you are ready to set that up, not before.
      </p>

      <span className="actions">
        {s.on
          ? <>
              <button className="btn" type="button" disabled={busy} onClick={turnOn}>Make a new key</button>
              <button className="btn btn-quiet" type="button" disabled={busy} onClick={turnOff}>Switch off</button>
            </>
          : <button className="btn btn-go" type="button" disabled={busy} onClick={turnOn}>Switch on and make a key</button>}
      </span>
    </section>
  );
}
