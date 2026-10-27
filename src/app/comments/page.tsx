"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, useToast } from "@/components/ui";
import type { Conversation, Option } from "@/lib/joinin";

/* Posts worth commenting on, laid out the way they look on the platform they came from.

   The point of the feed shape is judgement. A comment is read underneath a post, by people who
   have just read that post, so the only way to tell whether a draft belongs is to see the two
   together. A table of post summaries beside a table of drafts makes that impossible, which is
   why this does not use one.

   Five options per post rather than one. Judging a single draft in isolation takes minutes and
   usually ends in "write it again"; choosing between five that come at the post from genuinely
   different angles takes seconds. Nothing here posts anything — you pick one, copy it, and the
   button opens the real post so you can leave it yourself. */

type Data = {
  conversations: Conversation[];
  summary: { total: number; new: number; drafted: number; joined: number; blocked: number };
  platforms: readonly string[];
  angles: readonly { key: string; label: string }[];
  voices: readonly string[];
};

const parse = (raw: string): Option[] => {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

/* What the link check could conclude. Both platforms wall scripts, so "blocked" is the normal
   answer for a perfectly good post and must not read as a fault. */
const REACH: Record<string, string> = {
  ok: "link checked",
  blocked: "open it to see — the platform blocks scripts",
  gone: "this post is not there any more",
  unchecked: "not checked",
};

const initials = (name: string) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const FILTERS = [
  { key: "new", label: "Nothing drafted" },
  { key: "drafted", label: "Ready to post" },
  { key: "joined", label: "Commented" },
  { key: "", label: "All" },
];

export default function CommentsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState("new");
  const [busy, setBusy] = useState("");
  const [look, setLook] = useState<{ topics: string; platforms: string[] } | null>(null);
  const [voice, setVoice] = useState<"brand" | "person">("person");
  /* A post you found yourself. The only way to get an X post in — search cannot see them. */
  const [link, setLink] = useState("");
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
        push(`${c.platform} post added${c.full_text ? " and read" : ""} — write the comments`, "ok");
        setLink("");
      }
      if (body.action === "draft") {
        const n = parse((r as unknown as Conversation).options).length;
        push(`${n} way${n === 1 ? "" : "s"} to answer it — pick one`, "ok");
      }
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(""); }
  };

  if (!d) return <p className="muted">Loading…</p>;
  const shown = d.conversations.filter((c) => (tab ? c.status === tab : true));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Comments</h2>
          <p className="lede">
            Posts on LinkedIn and X where a comment from you would belong, each with five ways to answer it.
            Circuit finds them and writes the options; you pick one and post it yourself.
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
            onClick={() => setLook({ topics: "", platforms: ["LinkedIn", "X"] })}>Find posts</button>
        </span>
      </div>

      {/* Paste what you already found. You scroll both platforms every day and see posts no
          search will surface — on X, search surfaces none at all. */}
      <form className="pastebar" onSubmit={(e) => { e.preventDefault(); if (link.trim()) act({ action: "add", url: link }, "add"); }}>
        <input className="input" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy === "add"}
          placeholder="Paste a LinkedIn or X post link you want to comment on" aria-label="Link to a post" />
        <button className="btn" type="submit" disabled={!link.trim() || Boolean(busy)}>
          {busy === "add" ? "Reading…" : "Add it"}
        </button>
      </form>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={tab === f.key ? "active" : ""} onClick={() => setTab(f.key)}>
            {f.label} ({d.conversations.filter((c) => (f.key ? c.status === f.key : true)).length})
          </button>
        ))}
      </div>

      {shown.length ? (
        <div className="feed">
          {shown.map((c) => {
            const options = parse(c.options);
            const li = c.platform === "LinkedIn";
            return (
              <article key={c.id} className={`post ${li ? "li" : "x"}`}>
                {/* The post, as it looks where it lives. */}
                <header>
                  <span className="av">{initials(c.author)}</span>
                  <div className="who">
                    <strong>{c.author || "Someone"}</strong>
                    <small>
                      {li ? "LinkedIn" : "X"} · {fmtDay(c.found_at)}
                      {c.topic ? ` · ${c.topic}` : ""}
                    </small>
                  </div>
                  <a className="btn small ghost" href={c.url} target="_blank" rel="noreferrer">Open</a>
                </header>

                {/* The post itself, in the platform's own embed. Both publish one for exactly
                    this, and seeing the real thing is the only way to judge whether a comment
                    belongs under it — a paraphrase in a card is not the same post. */}
                {/* The post's own picture, where it has one. Shown above the embed so the list
                    reads at a glance: a text post and one built round a photograph want
                    different comments, and the embed only reveals which after it loads. */}
                {c.image ? <img className="postpic" src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}

                {c.embed ? (
                  /* Scrollable on purpose: the embed cannot tell us how tall it is, and the
                     Oye Electric post runs to eighteen lines. Clipping it would hide the half
                     a comment most needs to answer. */
                  <iframe className="embed" src={c.embed} title={`${c.platform} post by ${c.author || "someone"}`}
                    loading="lazy" frameBorder="0" allowFullScreen />
                ) : (
                  <p className="body">{c.full_text || c.said || <span className="muted">Nothing was recorded for this one.</span>}</p>
                )}

                <div className="meta">
                  <span className={c.reachable === "gone" ? "bad-text" : "muted"}>
                    {c.full_text ? "post read — the comments answer what it actually says" : REACH[c.reachable] || c.reachable}
                  </span>
                  {!c.full_text ? (
                    <button className="linky" type="button" disabled={Boolean(busy)}
                      onClick={() => act({ action: "refresh", id: c.id }, c.id)}>read the post</button>
                  ) : null}
                  {c.why ? <span className="muted">· {c.why}</span> : null}
                </div>

                {/* The comment box, under the post, where a comment actually goes. */}
                <div className="replies">
                  {options.length ? (
                    <>
                      <span className="eyebrow">
                        {options.length} ways to answer{c.voice === "person" ? ", as you" : ", as BNC"}
                        {c.chosen >= 0 ? " · one picked" : ""}
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
                            {c.chosen === i
                              ? <a className="btn small primary" href={c.url} target="_blank" rel="noreferrer"
                                  onClick={() => act({ id: c.id, status: "joined" }, "")}>Open and post it</a>
                              : null}
                          </div>
                        </div>
                      ))}
                      <div className="actions">
                        <button className="btn small ghost" type="button" disabled={Boolean(busy)}
                          onClick={() => act({ action: "draft", id: c.id, voice }, c.id)}>
                          {busy === c.id ? "Writing five…" : `Write five more${c.voice !== voice ? (voice === "person" ? ", as you" : ", as BNC") : ""}`}
                        </button>
                        <button className="btn small ghost" type="button" onClick={() => act({ id: c.id, status: "ignored" }, "")}>Not for us</button>
                      </div>
                    </>
                  ) : (
                    <div className="actions">
                      <button className="btn small primary" type="button" disabled={Boolean(busy)}
                        onClick={() => act({ action: "draft", id: c.id, voice }, c.id)}>
                        {busy === c.id ? "Writing five…" : "Write five comments"}
                      </button>
                      <button className="btn small ghost" type="button" onClick={() => act({ id: c.id, status: "ignored" }, "")}>Not for us</button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title={d.conversations.length ? "Nothing in this view" : "No posts yet"}
          hint={d.conversations.length ? "Try another tab." : "Press “Find posts” and Circuit searches LinkedIn and X for recent posts about electric two-wheelers, running cost, charging and fleets where a comment from you would add something."} />
      )}

      {/* Said where it will be read, because a thin list here is a fact about the platforms
          rather than about Circuit, and would otherwise look like a fault. */}
      <div className="note small">
        <strong>What this can and cannot do</strong>
        Circuit does not read LinkedIn or X — both block everything that is not a signed-in browser, and
        automating them is against their terms. It finds posts through search, checks every link, reads each post
        through the platform&rsquo;s own embed, and writes the comments. You post them.
        <br /><br />
        <strong>Search reaches LinkedIn thinly and X not at all.</strong> X blocks crawlers and needs a login for
        most content, so almost nothing of it is in any search index — an X search phrased as loosely as possible
        came back with nothing. That is not a setting that can be changed. For X, and for the LinkedIn posts search
        never sees, paste the link above: you are scrolling both platforms anyway, and a post you picked is better
        than one a search guessed at. A paid X API tier would restore proper X search if it is ever worth the cost.
      </div>

      {look ? (
        <Modal title="Find posts worth commenting on" eyebrow="LinkedIn and X" onClose={() => setLook(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); act({ action: "find", ...look, limit: 10 }, "find"); setLook(null); }}>
            <label className="field"><span>What to look for <em className="muted">leave blank for the usual subjects</em></span>
              <input className="input" value={look.topics} autoFocus
                placeholder="range anxiety, fleet electrification, charging at home"
                onChange={(e) => setLook({ ...look, topics: e.target.value })} />
            </label>
            <div className="field">
              <span>Where</span>
              <div className="row tight">
                {(d.platforms || ["LinkedIn", "X"]).map((pf) => (
                  <label key={pf} className="qa-item">
                    <input type="checkbox" checked={look.platforms.includes(pf)}
                      onChange={(e) => setLook({ ...look, platforms: e.target.checked ? [...look.platforms, pf] : look.platforms.filter((x) => x !== pf) })} />
                    <span>{pf}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="note small">
              Leave it blank and Circuit searches one platform at a time across six kinds of conversation — people
              choosing a bike, fleets electrifying, range and charging, running cost and policy, competitor
              launches, and what ownership is really like after a year. One search naming both platforms comes back
              all LinkedIn, so each asks about one only, and it stops as soon as it has ten. Four to eight minutes,
              and every link is checked before it is kept.
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
