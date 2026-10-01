"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, postJson, fileUrl } from "@/lib/api";
import { Modal, useToast } from "@/components/ui";
import { PlatformMarks } from "@/components/Platform";
import { HealthStrip } from "@/components/Health";
import {
  type Slot, type Pillar, type Suggestion, type ContentPlan, SLOT_PLATFORMS, FORMAT_LABEL,
  dayKey, monthKey, niceDate,
} from "@/lib/slotui";

/* Everything on the calendar is a layer you tick on or off, so you can see it all at once. */
type Layer = "slots" | "count" | "platforms" | "pillars" | "pics" | "status" | "buying" | "festival" | "other";
const LAYERS: { key: Layer; label: string; dot?: string }[] = [
  { key: "slots", label: "Posts" },
  { key: "count", label: "Count" },
  { key: "platforms", label: "Platforms" },
  { key: "pillars", label: "Pillars" },
  { key: "pics", label: "Pictures" },
  { key: "status", label: "Next step" },
  { key: "buying", label: "Buying days", dot: "buying" },
  { key: "festival", label: "Festivals", dot: "festival" },
  { key: "other", label: "Awareness days", dot: "other" },
];
const DEFAULT_LAYERS: Layer[] = ["slots", "buying", "festival", "other"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Sugg = { suggestions: Suggestion[]; perWeek: number; dataDriven: boolean; measuredPosts: number };
type KeyDate = { date: string; name: string; kind: string; buying?: boolean; note: string };
type Idea = { topic: string; format?: string; hook?: string; why?: string; conversation?: string; keywords?: string[] };
type IdeasStatus = {
  job: { status: string; error: string; created_at: string } | null; open_slots: number;
  conversation: { gathered_at: string; seeds: string[]; errors: string[]; counts: Record<string, number> } | null;
};
const ideasOf = (s: Slot) => ((s.research as Record<string, unknown>)?.topic_ideas as Idea[] | undefined) || [];
const shiftMonth = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export default function CalendarPage() {
  const router = useRouter();
  const { push, view } = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [all, setAll] = useState<Slot[] | null>(null);
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [dates, setDates] = useState<KeyDate[]>([]);
  const [ideas, setIdeas] = useState<IdeasStatus | null>(null);
  const [hasProfile, setHasProfile] = useState(true);
  const [layers, setLayers] = useState<Layer[]>(DEFAULT_LAYERS);
  // remember what the owner ticked
  useEffect(() => {
    try { const raw = localStorage.getItem("circuit-layers"); if (raw) setLayers(JSON.parse(raw) as Layer[]); } catch { /* first run */ }
  }, []);
  const on = (k: Layer) => layers.includes(k);
  const toggle = (k: Layer) => setLayers((prev) => {
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    try { localStorage.setItem("circuit-layers", JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });
  const setAllLayers = (everything: boolean) => {
    const next = everything ? LAYERS.map((l) => l.key) : [];
    setLayers(next);
    try { localStorage.setItem("circuit-layers", JSON.stringify(next)); } catch { /* private window */ }
  };
  const [adding, setAdding] = useState<string | null>(null);
  const [picking, setPicking] = useState<Slot | null>(null);
  const [managingPlan, setManagingPlan] = useState(false);
  const [sugg, setSugg] = useState<Sugg | null>(null);
  const [picked, setPicked] = useState<Record<number, Suggestion>>({});
  const [perWeek, setPerWeek] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const mk = monthKey(month);
  const today = dayKey(new Date());
  const monthName = month.toLocaleDateString("en-IN", { month: "long" });

  const days = useMemo(() => {
    const offset = (month.getDay() + 6) % 7;
    const inMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((offset + inMonth) / 7) * 7;
    const start = new Date(month);
    start.setDate(1 - offset);
    return Array.from({ length: cells }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);

  const load = useCallback(async () => {
    const first = dayKey(days[0]);
    const last = dayKey(days[days.length - 1]);
    const [s, p, kd, st] = await Promise.all([
      api<Slot[]>("/api/slots"), api<Pillar[]>("/api/pillars"), api<KeyDate[]>(`/api/dates?from=${first}&to=${last}`), api<IdeasStatus>(`/api/ideas?month=${mk}`),
    ]);
    setAll(s); setPillars(p); setDates(kd); setIdeas(st);
  }, [days, mk]);
  useEffect(() => { load().catch((e: Error) => push(e.message, "bad")); }, [load, push]);

  // open on the first month that has upcoming posts, not an empty current month
  const jumped = useRef(false);
  useEffect(() => {
    if (!all || jumped.current) return;
    jumped.current = true;
    const next = all.filter((s) => s.date >= today).map((s) => s.date).sort()[0];
    if (next && next.slice(0, 7) > monthKey(month)) {
      const [y, m] = next.split("-").map(Number);
      setMonth(new Date(y, m - 1, 1));
    }
  }, [all, today, month]);

  // ideas are automatic: this month and next get ChatGPT's ideas for every post without a topic
  useEffect(() => {
    api<{ profile: unknown }>("/api/brand").then((b) => setHasProfile(Boolean(b.profile))).catch(() => null);
    const now = new Date();
    for (const m of [monthKey(now), monthKey(shiftMonth(now, 1))]) {
      postJson<{ queued: boolean }>("/api/ideas/queue", { month: m }).then((r) => { if (r.queued) load().catch(() => null); }).catch(() => null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ideasWaiting = ideas?.job && (ideas.job.status === "queued" || ideas.job.status === "running");
  const claudeBusy = Boolean(ideasWaiting) || (all || []).some((s) => s.next?.who === "claude");
  useEffect(() => {
    if (!claudeBusy) return;
    const t = setInterval(() => load().catch(() => null), 15000);
    return () => clearInterval(t);
  }, [claudeBusy, load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of all || []) m.set(s.date, [...(m.get(s.date) || []), s]);
    return m;
  }, [all]);
  const datesByDay = useMemo(() => {
    const m = new Map<string, KeyDate[]>();
    for (const x of dates) m.set(x.date, [...(m.get(x.date) || []), x]);
    return m;
  }, [dates]);
  const slots = useMemo(() => (all || []).filter((s) => s.date.startsWith(mk)), [all, mk]);
  const monthDates = dates.filter((x) => x.date.startsWith(mk));
  const withIdeas = slots.filter((s) => !s.topic && ideasOf(s).length && s.date >= today).length;

  const suggest = async (n?: number | "") => {
    setBusy(true);
    try {
      const r = await postJson<Sugg>("/api/slots/suggest", { month: mk, per_week: (n ?? perWeek) || undefined });
      setSugg(r);
      setPicked(Object.fromEntries(r.suggestions.map((x, i) => [i, x])));
      if (!r.suggestions.length) push(`${monthName} is already fully planned`, "");
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const acceptSuggestions = async () => {
    const list = Object.values(picked);
    if (!list.length) return push("Pick at least one day", "bad");
    setBusy(true);
    try {
      await postJson("/api/slots", { slots: list.map((x) => ({ ...x, source: "suggested" })) });
      push(`Added ${list.length} post${list.length > 1 ? "s" : ""} to ${monthName}. ChatGPT will suggest topics for them.`, "ok");
      setSugg(null);
      setPicked({});
      await postJson("/api/ideas/queue", { month: mk }).catch(() => null);
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const removeSlot = async (s: Slot) => {
    if (!confirm(`Remove the post on ${niceDate(s.date)}? Any drafts stay in the Library.`)) return;
    await api(`/api/slots?id=${s.id}`, { method: "DELETE" });
    load();
  };
  const openSlot = (s: Slot) => {
    if (!s.topic.trim() && s.date >= today) setPicking(s);
    else router.push(`/slot/${s.id}`);
  };

  const chip = (s: Slot) => {
                  const ideaList = ideasOf(s);
                  const choosing = !s.topic.trim() && s.date >= today;
                  return (
                    <div key={s.id} className={`slot-chip who-${s.next?.who || "you"} ${choosing && ideaList.length ? "has-ideas" : ""}`} onClick={() => openSlot(s)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openSlot(s)}
                      /* Everything the line does not show is still here to read on hover, so the
                         quiet view costs nothing. */
                      title={[s.topic || (ideaList.length ? `Ideas: ${ideaList.map((i) => i.topic).join(" · ")}` : "No topic yet"), s.pillar_name, s.next?.label].filter(Boolean).join(" · ")}>
                      {on("pics") && s.final_file_id ? <img src={fileUrl(s.final_file_id)} alt="" className="chip-thumb" /> : null}
                      {on("pillars") ? <span className="chip-pillar">{s.pillar_name || "No pillar"}</span> : null}
                      <span className="chip-line">
                        {/* The bullet is the status: who it is waiting on, in one dot. */}
                        <span className="dot" aria-hidden="true" />
                        {s.topic ? <span className="chip-title">{s.topic}</span>
                          : choosing && ideaList.length ? <span className="chip-title idea-topic">{ideaList[0].topic}</span>
                          : <span className="chip-title no-topic">{choosing ? (ideasWaiting ? "Ideas coming…" : "Choose a topic") : "No topic"}</span>}
                      </span>
                      {on("status") ? (
                        <span className="chip-meta">
                          {choosing && ideaList.length ? <>{ideaList.length} ideas · {FORMAT_LABEL[ideaList[0].format || "image"]}</> : (s.next?.label || "").replace(/^ChatGPT is (\w)/, (_, c: string) => c.toUpperCase())}
                        </span>
                      ) : null}
                      <button className="chip-x" type="button" aria-label="Remove post" onClick={(e) => { e.stopPropagation(); removeSlot(s); }}>×</button>
                    </div>
                  );
                };

  if (!all) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {view}
      <HealthStrip />
      <div className="page-head cal-head">
        <div className="month-nav">
          <button className="btn small" type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <h2>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
          <button className="btn small" type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
          {mk !== monthKey(new Date()) ? <button className="btn small ghost" type="button" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>This month</button> : null}
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setManagingPlan(true)}>Content plan</button>
          <button className="btn primary" type="button" disabled={busy} onClick={() => suggest()}>{busy ? "Planning…" : `Add posts to ${monthName}`}</button>
        </div>
      </div>

      <p className="lede" style={{ margin: "2px 0 0", maxWidth: "62ch" }}>
        Every post this month. Click a day to pick its topic; the dot on each post says who it is waiting on —
        <span className="who-key"><span className="dot who-you" /> you</span>
        <span className="who-key"><span className="dot who-claude" /> ChatGPT</span>
        <span className="who-key"><span className="dot who-team" /> someone else</span>
        <span className="who-key"><span className="dot who-done" /> done</span>.
      </p>

      <div className="cal-status">
        {!hasProfile ? <span><Link href="/settings">Add your website in Settings</Link> so topic ideas start from your brand.</span> : null}
        {ideasWaiting ? <span><span className="pulse" aria-hidden="true" /> ChatGPT is writing topic ideas for {ideas?.open_slots || "the"} post{ideas?.open_slots === 1 ? "" : "s"} from this month&apos;s research.</span>
          : withIdeas ? <span>Topic ideas are ready on {withIdeas} post{withIdeas === 1 ? "" : "s"}. Click a post to choose one.</span> : null}
        {ideas?.conversation ? (
          <span className="muted">Research: {[
            ideas.conversation.counts.google && `${ideas.conversation.counts.google} Google searches`,
            ideas.conversation.counts.youtube && `${ideas.conversation.counts.youtube} YouTube searches`,
            ideas.conversation.counts.news && `${ideas.conversation.counts.news} news stories`,
            ideas.conversation.counts.reddit && `${ideas.conversation.counts.reddit} Reddit threads`,
            ideas.conversation.counts.meta_ads && `${ideas.conversation.counts.meta_ads} competitor ads`,
            ideas.conversation.counts.instagram && `${ideas.conversation.counts.instagram} competitor Instagram posts`,
          ].filter(Boolean).join(", ") || "nothing reachable"}</span>
        ) : null}
      </div>

      <section className="panel stack" style={{ gap: 14 }}>
        <div className="planner-bar">
          <div className="layer-picks">
            <span className="chip-label">Show</span>
            {LAYERS.map((l) => (
              <label key={l.key} className={`layer ${on(l.key) ? "on" : ""}`}>
                <input type="checkbox" checked={on(l.key)} onChange={() => toggle(l.key)} />
                {l.dot ? <span className={`date-dot ${l.dot}`} /> : null}
                <span>{l.label}</span>
              </label>
            ))}
            <button className="btn small ghost" type="button" onClick={() => setAllLayers(layers.length < LAYERS.length)}>{layers.length < LAYERS.length ? "Everything" : "Clear"}</button>
          </div>
        </div>

        <div className="calendar planner">
          {DOW.map((d) => <div key={d} className="dow"><span>{d}</span></div>)}
          {days.map((d) => {
            const key = dayKey(d);
            const list = byDay.get(key) || [];
            const kd = (datesByDay.get(key) || []).filter((x) => on(x.buying ? "buying" : x.kind === "festival" ? "festival" : "other"));
            const other = d.getMonth() !== month.getMonth();
            const past = key < today;
            const platforms = Array.from(new Set(list.flatMap((s) => s.platforms)));
            const pillarNames = Array.from(new Set(list.map((s) => s.pillar_name).filter(Boolean))) as string[];
            return (
              <div key={key} className={`day ${other ? "other" : ""} ${past && !other ? "past" : ""} ${key === today ? "today" : ""}`}>
                <div className="day-top">
                  <span className="num">{d.getDate()}</span>
                  <span className="day-right">
                    {on("platforms") && platforms.length ? <PlatformMarks names={platforms} size={11} /> : null}
                    {!other && !past ? <button className="add" type="button" aria-label={`Add a post on ${niceDate(key)}`} onClick={() => setAdding(key)}>+</button> : null}
                  </span>
                </div>
                {kd.map((x) => <span key={x.name} className={`key-date ${x.buying ? "buying" : x.kind === "festival" ? "festival" : "other"}`} title={`${x.name}: ${x.note}`}>{x.name}</span>)}
                {on("slots") && list.map(chip)}
                {/* A big "1" under the single post it is counting says nothing the eye has not
                    already seen. The count only earns its place once a day is busy. */}
                {on("count") && list.length > 1 ? <div className="day-count" onClick={() => openSlot(list[0])}>{list.length} posts</div> : null}
                {on("pillars") && list.length ? <div className="day-tags">{(pillarNames.length ? pillarNames : ["No pillar"]).map((p) => <span key={p} className="pill info">{p}</span>)}</div> : null}
              </div>
            );
          })}
        </div>
        <div className="agenda">
          {days.filter((d) => d.getMonth() === month.getMonth()).map((d) => {
            const key = dayKey(d);
            const list = byDay.get(key) || [];
            const kd = (datesByDay.get(key) || []).filter((x) => on(x.buying ? "buying" : x.kind === "festival" ? "festival" : "other"));
            if ((!list.length || !on("slots")) && !kd.length) return null;
            return (
              <div key={key} className={`agenda-day ${key < today ? "past" : ""} ${key === today ? "today" : ""}`}>
                <div className="agenda-date"><strong>{d.getDate()}</strong><small>{d.toLocaleDateString("en-IN", { weekday: "short" })}</small></div>
                <div className="agenda-body">
                  {kd.map((x) => <span key={x.name} className={`key-date ${x.buying ? "buying" : x.kind === "festival" ? "festival" : "other"}`} title={x.note}>{x.name}</span>)}
                  {on("slots") ? list.map(chip) : null}
                  {on("count") && list.length > 1 ? <span className="pill">{list.length} posts</span> : null}
                  {on("platforms") && list.length ? <div className="day-tags"><PlatformMarks names={list.flatMap((x) => x.platforms)} /></div> : null}
                  {on("pillars") && list.length ? <div className="day-tags">{Array.from(new Set(list.map((x) => x.pillar_name).filter(Boolean))).map((p) => <span key={p as string} className="pill info">{p}</span>)}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {monthDates.length ? (
        <section className="panel stack" style={{ gap: 10 }}>
          <div className="panel-head" style={{ marginBottom: 0 }}><h3>Important dates in {monthName}</h3></div>
          <ul className="date-list">
            {monthDates.map((x) => (
              <li key={`${x.date}-${x.name}`} className={x.date < today ? "past" : ""}>
                <span className={`date-dot ${x.buying ? "buying" : x.kind === "festival" ? "festival" : "other"}`} />
                <strong>{niceDate(x.date)}</strong>
                <span>{x.name}</span>
                <small>{x.note}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {picking ? <IdeaPicker slot={picking} nearDates={dates.filter((x) => Math.abs(new Date(`${x.date}T00:00`).getTime() - new Date(`${picking.date}T00:00`).getTime()) <= 3 * 86400000)} waiting={Boolean(ideasWaiting)} onClose={() => setPicking(null)} onChanged={load} push={push} /> : null}

      {sugg ? (
        <Modal title={`Add posts to ${monthName}`} onClose={() => setSugg(null)}>
          <div className="stack">
            <div className="plan-head">
              <p className="small muted" style={{ margin: 0 }}>
                {sugg.dataDriven ? `Picked from the days and platforms that did best across ${sugg.measuredPosts} posts with results.` : "Each weekday gets its pillar from your content plan."}
              </p>
              <label className="inline-num">
                <select className="select" value={perWeek || sugg.perWeek} onChange={(e) => { const n = Number(e.target.value); setPerWeek(n); suggest(n); }}>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>posts a week</span>
              </label>
            </div>
            {sugg.suggestions.length ? (
              <div className="list">
                {sugg.suggestions.map((x, i) => {
                  const on = Boolean(picked[i]);
                  const cur = picked[i] || x;
                  const near = dates.filter((kd) => kd.date === x.date);
                  return (
                    <div key={`${x.date}-${i}`} className={`sugg-row ${on ? "on" : ""}`}>
                      <label className="sugg-check"><input type="checkbox" checked={on} onChange={() => setPicked((p) => { const n = { ...p }; if (n[i]) delete n[i]; else n[i] = x; return n; })} /></label>
                      <div className="sugg-main">
                        <strong>{niceDate(x.date)}{near.length ? ` · ${near.map((n) => n.name).join(", ")}` : ""}</strong>
                        <p>{x.reason}</p>
                      </div>
                      <div className="sugg-edit">
                        <select className="select" value={cur.pillar_id || ""} disabled={!on} onChange={(e) => setPicked((p) => ({ ...p, [i]: { ...cur, pillar_id: e.target.value || null, pillar_name: pillars.find((pp) => pp.id === e.target.value)?.name || null } }))}>
                          <option value="">No pillar</option>
                          {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <select className="select" value={cur.platforms[0] || ""} disabled={!on} onChange={(e) => setPicked((p) => ({ ...p, [i]: { ...cur, platforms: [e.target.value] } }))}>
                          {SLOT_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="muted">Every open day in {monthName} already has a post.</p>}
            <div className="actions">
              <button className="btn primary" type="button" disabled={busy || !Object.keys(picked).length} onClick={acceptSuggestions}>Add {Object.keys(picked).length} post{Object.keys(picked).length === 1 ? "" : "s"}</button>
              <button className="btn ghost" type="button" onClick={() => setSugg(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {adding ? <AddSlot date={adding} pillars={pillars} onClose={() => setAdding(null)} onDone={(id) => { setAdding(null); router.push(`/slot/${id}`); }} push={push} /> : null}
      {managingPlan ? <PlanManager month={mk} monthLabel={monthName} pillars={pillars} onClose={() => setManagingPlan(false)} onChange={load} push={push} /> : null}
    </div>
  );
}

/* Choose a topic straight from the calendar: ChatGPT's ideas for this post, or your own. */
function IdeaPicker({ slot, nearDates, waiting, onClose, onChanged, push }: { slot: Slot; nearDates: KeyDate[]; waiting: boolean; onClose: () => void; onChanged: () => void; push: (t: string, tone?: string) => void }) {
  const router = useRouter();
  const list = ideasOf(slot);
  const [chosen, setChosen] = useState<number | null>(list.length ? 0 : null);
  const [own, setOwn] = useState("");
  const [format, setFormat] = useState(list[0]?.format || slot.format || "image");
  const [busy, setBusy] = useState(false);
  const pick = (i: number) => { setChosen(i); setOwn(""); setFormat(list[i].format || "image"); };
  const topic = own.trim() || (chosen !== null ? list[chosen]?.topic : "") || "";
  const use = async () => {
    if (!topic) return push("Pick an idea or write your own topic", "bad");
    setBusy(true);
    try {
      const idea = chosen !== null && !own.trim() ? list[chosen] : null;
      await postJson("/api/slots", { id: slot.id, topic, format, status: "in_progress", research: idea ? { chosen_idea: idea, keywords: idea.keywords || [] } : {} }, "PATCH");
      // research starts the moment a topic is chosen
      void postJson(`/api/slots/${slot.id}/research`, {}).catch(() => null);
      router.push(`/slot/${slot.id}`);
    } catch (e) {
      push((e as Error).message, "bad");
      setBusy(false);
    }
  };
  const askAgain = async () => {
    await postJson("/api/slots/topics", { slot_id: slot.id });
    push("Asked ChatGPT for new ideas for this post", "ok");
    onChanged();
    onClose();
  };
  return (
    <Modal title={`${niceDate(slot.date)} · ${slot.pillar_name || "Post"}`} onClose={onClose}>
      <div className="stack">
        {nearDates.length ? <div className="chips">{nearDates.map((x) => <span key={x.name} className={`key-date ${x.buying ? "buying" : x.kind === "festival" ? "festival" : "other"}`} title={x.note}>{niceDate(x.date)}: {x.name}</span>)}</div> : null}
        {list.length ? (
          <div className="idea-grid picker">
            {list.map((i, n) => (
              <button key={i.topic} type="button" className={`idea ${chosen === n && !own.trim() ? "on" : ""}`} onClick={() => pick(n)} aria-pressed={chosen === n && !own.trim()}>
                <span className="idea-top"><strong>{i.topic}</strong><span className="pill">{FORMAT_LABEL[i.format || "image"]}</span></span>
                {i.hook ? <span className="idea-hook">&ldquo;{i.hook}&rdquo;</span> : null}
                {i.why ? <span>{i.why}</span> : null}
                {i.conversation ? <span className="idea-src">From: {i.conversation}</span> : null}
              </button>
            ))}
          </div>
        ) : <div className="note">{waiting ? <><div className="progress" style={{ marginBottom: 8 }}><span /></div><strong>ChatGPT is writing ideas for this post</strong>They appear here in a few minutes. You can also write your own topic.</> : <><strong>No ideas yet</strong>Write your own topic, or ask ChatGPT for ideas.</>}</div>}
        <label className="field"><span>Or write your own</span><input className="input" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Your topic" /></label>
        <div className="field"><span>Format</span>
          <div className="chips">{Object.entries(FORMAT_LABEL).map(([k, v]) => <button key={k} type="button" className={`chip ${format === k ? "on" : ""}`} onClick={() => setFormat(k)}>{v}</button>)}</div>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" disabled={busy || !topic} onClick={use}>{busy ? "Starting…" : "Use this topic and research it"}</button>
          <button className="btn ghost" type="button" onClick={askAgain}>Ask ChatGPT for new ideas</button>
          <Link className="btn ghost" href={`/slot/${slot.id}`}>Open post</Link>
        </div>
      </div>
    </Modal>
  );
}

function AddSlot({ date, pillars, onClose, onDone, push }: { date: string; pillars: Pillar[]; onClose: () => void; onDone: (id: string) => void; push: (t: string, tone?: string) => void }) {
  const [pillarId, setPillarId] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["Instagram"]);
  const [format, setFormat] = useState("image");
  const [topic, setTopic] = useState("");
  const [time, setTime] = useState("10:00");
  const [busy, setBusy] = useState(false);
  /* The other way in: a finished poster and a caption, with none of the eight steps.
     Some days the work is already done somewhere else and all Circuit has to do is hold it. */
  const [byHand, setByHand] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string; mime: string } | null>(null);
  const [caption, setCaption] = useState("");

  const upload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("files", f);
    fd.append("kind", "upload");
    fd.append("brand", "1");
    setBusy(true);
    try {
      const saved = await api<{ id: string; name: string; mime: string }[]>("/api/files", { method: "POST", body: fd });
      setPicked(saved[0]);
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
      ev.target.value = "";
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ ids: string[] }>("/api/slots", { date, time, pillar_id: pillarId || null, platforms, format, topic });
      /* Done by hand means done: the slot is marked finished and a post is written for each
         platform, carrying the poster and the caption. Nothing is left waiting on a step. */
      if (byHand && picked) {
        const when = new Date(`${date}T${time}:00`).toISOString();
        await Promise.all((platforms.length ? platforms : ["Instagram"]).map((platform) =>
          postJson("/api/posts", { platform, scheduled_at: when, caption, file_id: picked.id, slot_id: r.ids[0], notes: "Added by hand" })));
        /* by_hand is what tells the rest of Circuit not to ask for research, drafts or captions
           on this one — they already exist, they just were not made here. */
        await postJson("/api/slots", { id: r.ids[0], status: "scheduled", stage: 8, research: { by_hand: true } }, "PATCH");
        push(`Ready to go out on ${platforms.length || 1} place${platforms.length === 1 ? "" : "s"}`, "ok");
        onClose();
        return;
      }
      push("Slot added", "ok");
      onDone(r.ids[0]);
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`New slot · ${niceDate(date)}`} onClose={onClose}>
      <div className="stack">
        <div className="tabs">
          <button type="button" className={byHand ? "" : "on"} onClick={() => setByHand(false)}>Take it through the steps</button>
          <button type="button" className={byHand ? "on" : ""} onClick={() => setByHand(true)}>I already have the poster</button>
        </div>
        {byHand ? (
          <div className="hand-over">
            <div className="ho-pic">
              {picked ? (
                picked.mime.startsWith("video/")
                  ? <video src={fileUrl(picked.id)} controls />
                  : <img src={fileUrl(picked.id)} alt="" />
              ) : <span className="muted small">no picture yet</span>}
            </div>
            <div className="ho-body">
              <strong>Hand it straight over</strong>
              <p className="small muted">
                An image or a video off your machine. It goes on the calendar as ready to post, skipping every step,
                and it lands in the Library so it is findable afterwards.
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
        ) : null}
        {byHand ? (
          <label className="field"><span>Caption</span>
            <textarea className="textarea" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)}
              placeholder="Write it however you like. Nothing is generated unless you ask for it." />
          </label>
        ) : null}
        <div className="form-grid">
          <label className="field"><span>Content pillar</span>
            <select className="select" value={pillarId} onChange={(e) => setPillarId(e.target.value)}>
              <option value="">Decide later</option>
              {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Time</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <label className="field full"><span>Topic <em>optional, you can pick it in the slot</em></span><input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="For example: monsoon riding confidence" /></label>
        </div>
        <div className="field"><span>Platforms</span>
          <div className="chips">{SLOT_PLATFORMS.map((p) => <button key={p} type="button" className={`chip ${platforms.includes(p) ? "on" : ""}`} onClick={() => setPlatforms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}>{p}</button>)}</div>
        </div>
        <div className="field"><span>Format</span>
          <div className="chips">{Object.entries(FORMAT_LABEL).map(([k, v]) => <button key={k} type="button" className={`chip ${format === k ? "on" : ""}`} onClick={() => setFormat(k)}>{v}</button>)}</div>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" disabled={busy || (byHand && !picked)} onClick={save}>
            {busy ? "Adding…" : byHand ? "Put it on the calendar" : "Add and open"}
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          {byHand && !picked ? <span className="small muted">Choose a poster first</span> : null}
        </div>
      </div>
    </Modal>
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function PlanManager({ month, monthLabel, pillars, onClose, onChange, push }: { month: string; monthLabel: string; pillars: Pillar[]; onClose: () => void; onChange: () => void; push: (t: string, tone?: string) => void }) {
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [works, setWorks] = useState<Learned | null>(null);
  useEffect(() => { api<ContentPlan>("/api/plan").then(setPlan).catch((e: Error) => push(e.message, "bad")); }, [push]);
  useEffect(() => { api<Learned>("/api/performance").then(setWorks).catch(() => null); }, []);

  const totalW = pillars.reduce((a, p) => a + p.weight, 0) || 1;
  const savePlan = async (patch: Partial<ContentPlan>) => {
    if (!plan) return;
    setSaving(true);
    try {
      const next = await postJson<ContentPlan & { applied?: number }>("/api/plan", patch);
      setPlan(next);
      push(next.applied ? `Plan saved. ${next.applied} upcoming post${next.applied === 1 ? "" : "s"} moved to the new pillar; ChatGPT will redo their ideas.` : "Plan saved.", "ok");
      if (next.applied) { onChange(); postJson("/api/ideas/queue", { month }).catch(() => null); }
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };
  const patchPillar = async (p: Pillar, body: Partial<Pillar>) => {
    await postJson("/api/pillars", { id: p.id, ...body }, "PATCH");
    onChange();
  };
  const add = async () => {
    if (!name.trim()) return push("Give it a name", "bad");
    await postJson("/api/pillars", { name, description: desc });
    setName(""); setDesc("");
    onChange();
  };
  const remove = async (p: Pillar) => {
    if (!confirm(`Remove the "${p.name}" pillar? Slots using it keep their content.`)) return;
    await api(`/api/pillars?id=${p.id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <Modal title="Content plan" onClose={onClose}>
      {!plan ? <p className="muted">Loading…</p> : (
        <div className="stack">
          <p className="lede" style={{ marginTop: -6 }}>{plan.notes}</p>
          <LearnedNote works={works} />

          <div className="plan-grid">
            <label className="field"><span>Original posts a week</span>
              <select className="select" value={plan.per_week} disabled={saving} onChange={(e) => savePlan({ per_week: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
            <label className="field"><span>Posting time</span>
              <input className="input" type="time" value={plan.time} disabled={saving} onChange={(e) => savePlan({ time: e.target.value })} />
            </label>
            <label className="field"><span>Blog articles a month</span>
              <select className="select" value={plan.blog_per_month} disabled={saving} onChange={(e) => savePlan({ blog_per_month: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
          </div>

          <div className="field"><span>Posting days</span>
            <div className="chips">{DAY_NAMES.map((dn, i) => {
              const on = plan.days.includes(i);
              return <button key={dn} type="button" className={`chip ${on ? "on" : ""}`} disabled={saving} onClick={() => savePlan({ days: on ? plan.days.filter((x) => x !== i) : [...plan.days, i] })}>{dn}</button>;
            })}</div>
          </div>

          <div className="field"><span>Pillar for each weekday <em>pick two and they alternate week by week</em></span>
            <div className="day-pillars">
              {[1, 2, 3, 4, 5, 6, 0].map((dn) => {
                const cur = plan.day_pillars?.[String(dn)] || [];
                return (
                  <div key={dn} className="day-pillar-row">
                    <strong>{DAY_NAMES[dn]}{dn === 5 ? <small> testimonials</small> : null}</strong>
                    <div className="chips">
                      {pillars.map((p) => {
                        const on = cur.includes(p.name);
                        return <button key={p.id} type="button" className={`chip ${on ? "on" : ""}`} style={{ padding: "3px 8px", fontSize: 12 }} disabled={saving}
                          onClick={() => savePlan({ day_pillars: { ...plan.day_pillars, [String(dn)]: on ? cur.filter((x) => x !== p.name) : [...cur, p.name].slice(-2) } })}>{p.name}</button>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field"><span>Most posts a week per platform</span>
            <div className="plan-grid">
              {Object.entries(plan.platform_per_week).map(([pl, n]) => (
                <label key={pl} className="field" style={{ fontWeight: 400 }}><span>{pl}</span>
                  <select className="select" value={n} disabled={saving} onChange={(e) => savePlan({ platform_per_week: { ...plan.platform_per_week, [pl]: Number(e.target.value) } })}>{[0, 1, 2, 3, 4, 5, 6, 7].map((k) => <option key={k} value={k}>{k}</option>)}</select>
                </label>
              ))}
            </div>
          </div>

          <div className="panel-head" style={{ marginBottom: 0 }}><h3>Content pillars</h3><span className="small muted">Share of your posts</span></div>
          <div className="list">
            {pillars.map((p) => (
              <div key={p.id} className="pillar-row">
                <div className="pillar-main">
                  <strong>{p.name}</strong>
                  <p>{p.description}</p>
                  {p.examples.length ? <p className="pillar-ex">e.g. {p.examples.slice(0, 2).join(" · ")}</p> : null}
                  <div className="chips" style={{ marginTop: 6 }}>
                    {SLOT_PLATFORMS.map((pl) => {
                      const on = p.platforms.includes(pl);
                      return <button key={pl} type="button" className={`chip ${on ? "on" : ""}`} style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => patchPillar(p, { platforms: on ? p.platforms.filter((x) => x !== pl) : [...p.platforms, pl] })}>{pl}</button>;
                    })}
                  </div>
                </div>
                <div className="pillar-side">
                  <span className="pillar-pct">{Math.round((p.weight / totalW) * 100)}%</span>
                  <input type="range" min={5} max={50} step={5} value={p.weight} aria-label={`${p.name} share`} onChange={(e) => patchPillar(p, { weight: Number(e.target.value) })} />
                  <button className="btn small ghost" type="button" onClick={() => remove(p)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          <div className="form-grid">
            <label className="field"><span>New pillar</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Offers & launches" /></label>
            <label className="field"><span>What it covers</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Festive offers, new variants" /></label>
          </div>
          <div className="actions"><button className="btn" type="button" onClick={add}>Add pillar</button></div>

          <div className="note">
            <strong>Apply to {monthLabel}</strong>
            Gives every slot you haven&apos;t started a pillar, and suggested slots their platforms and time. Nothing is added or removed.
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn small" type="button" onClick={async () => {
                const r = await postJson<{ updated: number }>("/api/plan", { apply_month: month });
                push(r.updated ? `Updated ${r.updated} slot${r.updated > 1 ? "s" : ""}` : "Nothing to update: every slot already has a pillar or has been started", r.updated ? "ok" : "");
                onChange();
              }}>Apply plan to {monthLabel}</button>
            </div>
          </div>

          <details className="more">
            <summary>Why these numbers ›</summary>
            <ul className="basis">{plan.basis.map((b) => <li key={b.url}><a href={b.url} target="_blank" rel="noreferrer">{b.label} ↗</a></li>)}</ul>
          </details>
        </div>
      )}
    </Modal>
  );
}

/* The plan is convention until our own posts say otherwise. This puts what they say in front of
   whoever is editing the plan, and stays quiet while the evidence is thin. */
type Learned = { posts: number; advice: string[]; pillars: { label: string; posts: number; engagement: number; enough: boolean }[] };

function LearnedNote({ works }: { works: Learned | null }) {
  if (!works) return null;
  if (!works.advice.length) {
    return (
      <div className="note small">
        <strong>Nothing learned from our own posts yet</strong>
        {works.posts ? `Only ${works.posts} posted post${works.posts === 1 ? " has" : "s have"} numbers against them. Three in a group and this plan starts getting advice from what actually worked.` : "Mark posts as posted with their link, and Instagram numbers come in by themselves."}
      </div>
    );
  }
  return (
    <div className="note small ok">
      <strong>From our own results</strong>
      {works.advice.join(" ")} <Link href="/reports" style={{ textDecoration: "underline" }}>See the months</Link>
    </div>
  );
}
