"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDay } from "@/lib/api";
import { Empty, Modal, useToast } from "@/components/ui";
import type { Conversation, Option } from "@/lib/joinin";

/* The Engager: being seen in other people's conversations.

   Posts on LinkedIn, X, Instagram and Facebook where a comment from us would belong, each laid
   out the way it looks where it lives, with five ways to answer it underneath. The feed shape is
   for judgement: a comment is read under a post, by people who have just read that post, so the
   only way to tell whether a draft belongs is to see the two together.

   Five options rather than one, because choosing between five genuinely different angles takes
   seconds and judging one in isolation ends in "write it again". Nothing here posts anything —
   you pick one, it is copied, and the button opens the real post so you leave it yourself. The
   day's goal and the week beside the feed are there because engagement only works as a habit. */

type Stats = { goal: number; today: number; week: { day: string; n: number }[]; week_total: number; streak: number; by_platform: Record<string, number> };
type Data = {
  conversations: Conversation[];
  summary: { total: number; new: number; drafted: number; joined: number; blocked: number };
  stats: Stats;
  platforms: readonly string[];
  searchable: readonly string[];
};

const parse = (raw: string): Option[] => {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

/* What the link check could conclude. The platforms wall scripts, so "blocked" is the normal
   answer for a perfectly good post and must not read as a fault. */
const REACH: Record<string, string> = {
  ok: "link checked",
  blocked: "open it to see — the platform blocks scripts",
  gone: "this post is not there any more",
  unchecked: "not checked",
};
const TONE: Record<string, string> = { LinkedIn: "li", X: "x", Instagram: "ig", Facebook: "fb" };

const initials = (name: string) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const weekday = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "narrow" });

const FILTERS = [
  { key: "new", label: "To write" },
  { key: "drafted", label: "Ready to post" },
  { key: "joined", label: "Commented" },
  { key: "", label: "All" },
];

export default function EngagePage() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState("new");
  const [plat, setPlat] = useState("");
  const [busy, setBusy] = useState("");
  const [look, setLook] = useState<{ topics: string; platforms: string[] } | null>(null);
  const [voice, setVoice] = useState<"brand" | "person">("person");
  const [link, setLink] = useState("");
  /* The post's words, pasted by hand when the platform's embed would not give them up. */
  const [pasted, setPasted] = useState<Record<string, string>>({});
  const { push, view } = useToast();

  const load = useCallback(() => {
    api<Data>("/api/joinin").then(setD).catch((e: Error) => push(e.message, "bad"));
  }, [push]);
  useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const r = await postJson<Record<string, unknown>>("/api/joinin", body);
      if (body.action === "find") {
        const added = Number(r.added || 0);
        const rejected = (r.rejected as { url: string; why: string }[]) || [];
        const passes = Number(r.passes || 1);
        const split = Object.entries((r.perPlatform as Record<string, number>) || {})
          .filter(([, n]) => n > 0).map(([k, n]) => `${n} on ${k}`).join(", ");
        push(added
          ? `${added} worth commenting on${split ? ` — ${split}` : ""} · ${passes} search${passes === 1 ? "" : "es"}`
          : `Nothing new across ${passes} search${passes === 1 ? "" : "es"}${rejected.length ? ` — ${rejected.length} of what came back was not a real post` : ""}`, added ? "ok" : "");
      }
      if (body.action === "add") {
        const c = r as unknown as Conversation;
        push(c.full_text ? `${c.platform} post added and read — write the comments` : `${c.platform} post added — paste what it says, then write the comments`, "ok");
        setLink("");
      }
      if (body.action === "draft") {
        const n = parse((r as unknown as Conversation).options).length;
        push(`${n} way${n === 1 ? "" : "s"} to answer it — pick one`, "ok");
      }
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  /* Status and pasted text are edits to the post's row, not actions. */
  const save = async (id: string, body: Record<string, unknown>, done?: string) => {
    try { await postJson("/api/joinin", { id, ...body }, "PATCH"); if (done) push(done, "ok"); load(); }
    catch (e) { push((e as Error).message, "bad"); }
  };

  if (!d) return <p className="muted">Loading…</p>;
  const st = d.stats;
  const inPlat = d.conversations.filter((c) => !plat || c.platform === plat);
  const shown = inPlat.filter((c) => (tab ? c.status === tab : c.status !== "ignored"));
  const peak = Math.max(st.goal, ...st.week.map((w) => w.n));
  const left = Math.max(0, st.goal - st.today);

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h1>Engager</h1>
          <p className="lede">
            Be seen where your buyers already talk. Posts on LinkedIn, X, Instagram and Facebook where a comment from us
            would belong, each with five ways to answer — you pick one and post it yourself.
          </p>
        </div>
        <span className="actions">
          {/* Who the comment is from changes how it is written, and how far it travels. A
              company page comment reaches a fraction of what a person's does on LinkedIn. */}
          <div className="seg" role="group" aria-label="Who the comment is from">
            <button className={`seg-btn ${voice === "person" ? "on" : ""}`} type="button" aria-pressed={voice === "person"}
              onClick={() => setVoice("person")} title="Reaches further and reads as a human. Authority attaches to people.">As you</button>
            <button className={`seg-btn ${voice === "brand" ? "on" : ""}`} type="button" aria-pressed={voice === "brand"}
              onClick={() => setVoice("brand")} title="From the company account">As BNC</button>
          </div>
          <button className="btn primary" type="button" disabled={Boolean(busy)}
            onClick={() => setLook({ topics: "", platforms: [...d.searchable] })}>{busy === "find" ? "Looking…" : "Find posts"}</button>
        </span>
      </div>

      {/* Paste what you already found — you scroll these platforms every day and see posts no
          search will surface. On Instagram and Facebook it is the only way in. */}
      <form className="pastebar" onSubmit={(e) => { e.preventDefault(); if (link.trim()) act({ action: "add", url: link }, "add"); }}>
        <input className="input" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy === "add"}
          placeholder="Paste a LinkedIn, X, Instagram or Facebook post link you want to comment on" aria-label="Link to a post" />
        <button className="btn" type="submit" disabled={!link.trim() || Boolean(busy)}>{busy === "add" ? "Reading…" : "Add it"}</button>
      </form>

      <div className="eg">
        <div className="eg-main stack">
          <div className="eg-filters">
            <div className="tabs">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" className={tab === f.key ? "active" : ""} onClick={() => setTab(f.key)}>
                  {f.label} ({inPlat.filter((c) => (f.key ? c.status === f.key : c.status !== "ignored")).length})
                </button>
              ))}
            </div>
            <div className="wk-chips">
              {["", ...d.platforms].map((p) => (
                <button key={p || "all"} type="button" className={`chip ${plat === p ? "on" : ""}`} aria-pressed={plat === p} onClick={() => setPlat(p)}>
                  {p ? <><i className={`eg-dot ${TONE[p]}`} />{p}</> : "Every platform"}
                </button>
              ))}
            </div>
          </div>

          {shown.length ? (
            <div className="feed">
              {shown.map((c) => {
                const options = parse(c.options);
                return (
                  <article key={c.id} className={`post ${TONE[c.platform] || ""}`}>
                    <header>
                      <span className="av">{initials(c.author)}</span>
                      <div className="who">
                        <strong>{c.author || "Someone"}</strong>
                        <small>{c.platform} · {fmtDay(c.found_at)}{c.topic ? ` · ${c.topic}` : ""}</small>
                      </div>
                      <a className="btn small ghost" href={c.url} target="_blank" rel="noreferrer">Open</a>
                    </header>

                    {c.image ? <img className="postpic" src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                    {/* The post itself, in the platform's own embed — the real thing, not a paraphrase. */}
                    {c.embed ? (
                      <iframe className={`embed ${TONE[c.platform] || ""}`} src={c.embed} title={`${c.platform} post by ${c.author || "someone"}`}
                        loading="lazy" frameBorder="0" allowFullScreen />
                    ) : (
                      <p className="body">{c.full_text || c.said || <span className="muted">Nothing was recorded for this one.</span>}</p>
                    )}

                    <div className="meta">
                      <span className={c.reachable === "gone" ? "bad-text" : "muted"}>
                        {c.full_text ? "post read — the comments answer what it actually says" : REACH[c.reachable] || c.reachable}
                      </span>
                      {!c.full_text && (c.platform === "LinkedIn" || c.platform === "X") ? (
                        <button className="linky" type="button" disabled={Boolean(busy)} onClick={() => act({ action: "refresh", id: c.id }, c.id)}>read the post</button>
                      ) : null}
                      {c.why ? <span className="muted">· {c.why}</span> : null}
                    </div>

                    {/* When the platform would not hand the words over: paste them, so the
                        comments answer what the post says rather than a guess at it. */}
                    {!c.full_text && c.status !== "joined" ? (
                      <div className="eg-paste">
                        <textarea className="textarea" rows={3} value={pasted[c.id] ?? ""} placeholder="Paste what the post says — the comments are written to answer it"
                          onChange={(e) => setPasted({ ...pasted, [c.id]: e.target.value })} aria-label="What the post says" />
                        <button className="btn small" type="button" disabled={!(pasted[c.id] || "").trim()}
                          onClick={() => save(c.id, { full_text: pasted[c.id].trim() }, "Saved — now write the comments")}>Save the text</button>
                      </div>
                    ) : null}

                    <div className="replies">
                      {options.length ? (
                        <>
                          <span className="eyebrow">
                            {options.length} ways to answer{c.voice === "person" ? ", as you" : ", as BNC"}
                            {c.status === "joined" ? " · commented ✓" : c.chosen >= 0 ? " · one picked" : ""}
                          </span>
                          {options.map((o, i) => (
                            <div key={i} className={`opt ${c.chosen === i ? "on" : ""}`}>
                              <span className="opt-angle">{o.angle}</span>
                              <p>{o.text}</p>
                              <div className="actions">
                                <button className="btn small" type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(o.text);
                                    act({ action: "choose", id: c.id, index: i }, "");
                                    push("Copied — paste it under the post", "ok");
                                  }}>
                                  {c.chosen === i ? "Copy again" : "Use this one"}
                                </button>
                                {c.chosen === i && c.status !== "joined" ? (
                                  <a className="btn small primary" href={c.url} target="_blank" rel="noreferrer"
                                    onClick={() => save(c.id, { status: "joined" }, left > 1 ? `Counted — ${left - 1} to go today` : left === 1 ? "That's today's goal ✓" : "Counted")}>Open and post it</a>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          <div className="actions">
                            {c.status === "joined"
                              ? <button className="btn small ghost" type="button" onClick={() => save(c.id, { status: "drafted" })}>Not posted after all</button>
                              : <>
                                  <button className="btn small ghost" type="button" disabled={Boolean(busy)}
                                    onClick={() => act({ action: "draft", id: c.id, voice }, c.id)}>
                                    {busy === c.id ? "Writing five…" : `Write five more${c.voice !== voice ? (voice === "person" ? ", as you" : ", as BNC") : ""}`}
                                  </button>
                                  <button className="btn small ghost" type="button" onClick={() => save(c.id, { status: "ignored" }, "Set aside")}>Not for us</button>
                                </>}
                          </div>
                        </>
                      ) : (
                        <div className="actions">
                          <button className="btn small primary" type="button" disabled={Boolean(busy)}
                            onClick={() => act({ action: "draft", id: c.id, voice }, c.id)}>
                            {busy === c.id ? "Writing five…" : "Write five comments"}
                          </button>
                          <button className="btn small ghost" type="button" onClick={() => save(c.id, { status: "ignored" }, "Set aside")}>Not for us</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty title={d.conversations.length ? "Nothing in this view" : "No posts yet"}
              hint={d.conversations.length ? "Try another tab or platform." : "Paste a post link above, or press “Find posts” and Circuit searches LinkedIn and X for recent posts about electric two-wheelers, running cost, charging and fleets."} />
          )}
        </div>

        {/* ---- the habit ---- */}
        <aside className="eg-side">
          <section className="eg-card">
            <span className="eyebrow">Today</span>
            <div className="eg-today"><b>{st.today}</b><span>of {st.goal} comments</span></div>
            <div className="lr-bar"><i style={{ width: `${Math.min(100, (st.today / st.goal) * 100)}%` }} /></div>
            <p className="small muted" style={{ margin: 0 }}>
              {left ? `${left} more to reach today's goal.` : "Today's goal is done."}
              {st.streak ? ` ${st.streak}-day streak.` : ""}
            </p>
          </section>
          <section className="eg-card">
            <span className="eyebrow">The last seven days · {st.week_total}</span>
            <div className="eg-week" aria-label="Comments left each day">
              {st.week.map((w) => (
                <div key={w.day} title={`${w.day} · ${w.n}`}>
                  <i className={w.n >= st.goal ? "met" : ""} style={{ height: `${Math.max(4, (w.n / peak) * 100)}%` }} />
                  <span>{weekday(w.day)}</span>
                </div>
              ))}
            </div>
            {Object.keys(st.by_platform).length ? (
              <div className="eg-split small">
                {Object.entries(st.by_platform).map(([p, n]) => <span key={p}><i className={`eg-dot ${TONE[p]}`} />{p} {n}</span>)}
              </div>
            ) : null}
          </section>
          <section className="eg-card">
            <span className="eyebrow">Queue</span>
            <div className="eg-q"><span>To write</span><b>{d.summary.new}</b></div>
            <div className="eg-q"><span>Ready to post</span><b>{d.summary.drafted}</b></div>
            <div className="eg-q"><span>Commented in all</span><b>{d.summary.joined}</b></div>
          </section>
          <details className="eg-card small">
            <summary>What this can and cannot do</summary>
            <p className="muted">
              Circuit never posts or likes anything — every platform forbids automating that, and a comment is only worth
              leaving if a person chose it. It finds posts, reads them through each platform&rsquo;s own embed, and writes the options.
            </p>
            <p className="muted">
              Search reaches LinkedIn thinly and X barely; Instagram and Facebook not at all. Paste links for those — a post
              you picked beats one a search guessed at. When a platform will not show its words to Circuit, paste the text in.
            </p>
          </details>
        </aside>
      </div>

      {look ? (
        <Modal title="Find posts worth commenting on" eyebrow="LinkedIn and X" onClose={() => setLook(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); act({ action: "find", ...look, limit: 10 }, "find"); setLook(null); }}>
            <label className="field"><span>What to look for <em className="muted">leave blank for the usual subjects</em></span>
              <input className="input" value={look.topics} autoFocus placeholder="range anxiety, fleet electrification, charging at home"
                onChange={(e) => setLook({ ...look, topics: e.target.value })} />
            </label>
            <div className="field">
              <span>Where</span>
              <div className="row tight">
                {d.searchable.map((pf) => (
                  <label key={pf} className="qa-item">
                    <input type="checkbox" checked={look.platforms.includes(pf)}
                      onChange={(e) => setLook({ ...look, platforms: e.target.checked ? [...look.platforms, pf] : look.platforms.filter((x) => x !== pf) })} />
                    <span>{pf}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="note small">
              Leave it blank and Circuit searches one platform at a time across six kinds of conversation — people choosing a
              bike, fleets electrifying, range and charging, running cost and policy, competitor launches, and ownership after a
              year. Four to eight minutes, and every link is checked before it is kept. Instagram and Facebook posts come in by pasting a link.
            </div>
            <div className="actions">
              <button className="btn primary" type="submit" disabled={!look.platforms.length || Boolean(busy)}>Look now</button>
              <button className="btn ghost" type="button" onClick={() => setLook(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
