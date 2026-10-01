"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, PLATFORMS } from "@/lib/api";
import { Pill } from "@/components/ui";

/* Connecting Circuit to Postiz, which is what actually puts a post on a platform.
   The key is pasted by the owner and stays on this Mac, like every other credential here. */

type Channel = { id: string; name: string; identifier: string; picture?: string; disabled?: boolean };
type Status = { connected: boolean; base: string; channels: Channel[]; error: string; map: Record<string, string>; self_hosted: boolean };

export function PublishingPanel({ push }: { push: (t: string, tone?: string) => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [showKey, setShowKey] = useState(false);
  const load = useCallback(() => api<Status>("/api/postiz").then(setSt).catch(() => null), []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    const key = (document.getElementById("postiz-key") as HTMLInputElement | null)?.value || "";
    const url = (document.getElementById("postiz-url") as HTMLInputElement | null)?.value || "";
    if (!key.trim()) return push("Paste the API key first", "bad");
    setBusy("connect");
    try {
      const r = await postJson<Status>("/api/postiz", { action: "connect", key, url });
      setSt(r);
      push(r.connected ? `Connected · ${r.channels.length} channel${r.channels.length === 1 ? "" : "s"}` : r.error, r.connected ? "ok" : "bad");
      setShowKey(false);
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  const setChannel = async (platform: string, channelId: string) => {
    if (!st) return;
    const map = { ...st.map };
    if (channelId) map[platform] = channelId; else delete map[platform];
    setBusy(platform);
    try {
      setSt(await postJson<Status>("/api/postiz", { action: "map", map }));
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  if (!st) return null;
  const mapped = Object.keys(st.map).length;

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Posting to the platforms</h3>
        {st.connected
          ? <Pill tone="ok">Connected{st.self_hosted ? " · your own server" : ""}</Pill>
          : <Pill tone={st.error && st.error !== "No API key saved yet" ? "bad" : "warn"}>Not connected</Pill>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Circuit makes the post; <a href="https://postiz.com" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Postiz</a> puts it on Instagram, Facebook, LinkedIn and the rest.
        It holds the approved app for each platform, which is the part a laptop can&apos;t do. Nothing is ever published without you pressing it.
      </p>

      {!st.connected ? (
        <div className="note small">
          <strong>How to connect</strong>
          Sign in at postiz.com (the 7-day trial is enough to see it work), connect your channels there, then open Settings → Public API and copy the key.
        </div>
      ) : null}

      {st.error && st.error !== "No API key saved yet" ? <div className="note bad small"><strong>Postiz said no</strong>{st.error}</div> : null}

      {!st.connected || showKey ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="form-grid">
            <input className="input" id="postiz-key" type="password" placeholder="Postiz API key" autoComplete="off" />
            <input className="input" id="postiz-url" placeholder="Your own server's address, if self-hosted" defaultValue={st.self_hosted ? st.base : ""} autoComplete="off" />
          </div>
          <div className="actions">
            <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={connect}>{busy === "connect" ? "Checking…" : "Connect"}</button>
            {showKey ? <button className="btn ghost" type="button" onClick={() => setShowKey(false)}>Cancel</button> : null}
          </div>
        </div>
      ) : (
        <div className="actions">
          <button className="btn small" type="button" onClick={() => setShowKey(true)}>Change the key</button>
          <button className="btn small ghost" type="button" onClick={load}>Check again</button>
        </div>
      )}

      {st.connected ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Which channel is which</div>
          <p className="small muted" style={{ margin: 0 }}>
            Match each platform Circuit plans for to the channel you connected in Postiz. {mapped ? `${mapped} matched.` : "None matched yet, so nothing can be sent."}
          </p>
          <div className="pub-map">
            {PLATFORMS.filter((p) => !["Blog", "Email", "WhatsApp"].includes(p)).map((p) => (
              <label key={p} className="field">
                <span>{p}</span>
                <select className="select" value={st.map[p] || ""} disabled={busy === p} onChange={(e) => setChannel(p, e.target.value)}>
                  <option value="">Not posted from here</option>
                  {st.channels.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.identifier}{c.disabled ? " (disabled)" : ""}</option>)}
                </select>
              </label>
            ))}
          </div>
          {!st.channels.length ? <p className="small muted" style={{ margin: 0 }}>No channels in Postiz yet — connect them there first.</p> : null}
        </>
      ) : null}
    </section>
  );
}
