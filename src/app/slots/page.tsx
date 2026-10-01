"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, postJson, fileUrl } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";
import { type Slot, STAGE_LABELS, FORMAT_LABEL, niceDate, relDay } from "@/lib/slotui";
import { Tabs } from "@/components/Sheet";

/* The queue: what is actually in hand, and how far along each one is.

   A post with nothing done to it is not work in progress — it is an empty slot, and a page that
   lists fourteen of them at the top reads as fourteen jobs when it is really one decision. So
   the queue holds only posts that have moved past the first step, each showing how far it has
   got and what it needs next. Everything untouched sits below, as the backlog it is.

   Order matters more than grouping here: whatever is waiting on you, soonest first, because
   that is the order you would work in anyway. */

type Idea = { topic: string; format?: string; hook?: string; why?: string; conversation?: string; keywords?: string[] };
const ideasOf = (s: Slot) => ((s.research as Record<string, unknown>)?.topic_ideas as Idea[] | undefined) || [];

/* How many steps a post has to have behind it before it counts as work in hand. Four: by then
   the topic is chosen, the angle is set, the references are in and the drafts exist — it is a
   real thing you can finish, rather than a slot with a title on it. */
const IN_HAND_AFTER = 4;

export default function SlotsPage() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [showBacklog, setShowBacklog] = useState(false);
  const { push, view } = useToast();
  const load = useCallback(() => api<Slot[]>("/api/slots").then(setSlots).catch(() => setSlots([])), []);
  useEffect(() => { load(); }, [load]);

  /* Taking an idea is the same thing the calendar's picker does: save the topic and format,
     keep the idea and its keywords, and start the research straight away. */
  const useIdea = async (s: Slot, idea: Idea) => {
    setBusy(s.id);
    try {
      await postJson("/api/slots", {
        id: s.id, topic: idea.topic, format: idea.format || s.format || "image", status: "in_progress",
        research: { chosen_idea: idea, keywords: idea.keywords || [] },
      }, "PATCH");
      void postJson(`/api/slots/${s.id}/research`, {}).catch(() => null);
      push(`“${idea.topic}” taken. ChatGPT is researching it now.`, "ok");
      await load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  };

  const useAll = async (list: Slot[]) => {
    if (!confirm(`Take the first idea on all ${list.length} posts? You can change any of them afterwards.`)) return;
    setBusy("all");
    let done = 0;
    for (const s of list) {
      const idea = ideasOf(s)[0];
      if (!idea) continue;
      try {
        await postJson("/api/slots", {
          id: s.id, topic: idea.topic, format: idea.format || s.format || "image", status: "in_progress",
          research: { chosen_idea: idea, keywords: idea.keywords || [] },
        }, "PATCH");
        void postJson(`/api/slots/${s.id}/research`, {}).catch(() => null);
        done++;
      } catch { /* keep going: one failure shouldn't stop the month */ }
    }
    push(`${done} post${done === 1 ? "" : "s"} now have a topic. ChatGPT is researching them.`, "ok");
    setBusy("");
    load();
  };

  if (!slots) return <p className="muted">Loading…</p>;
  const live = slots.filter((s) => s.status !== "posted");
  const done = slots.filter((s) => s.status === "posted");

  /* A post sitting on step 2 has one step behind it, not two — the step it is on is the one
     still to do. So "steps completed" is the stage minus one, and a post joins the queue once
     four of them are behind it. Anything less is early days, not work in hand. */
  const stepsDone = (s: Slot) => Math.max((s.next?.stage || s.stage || 1) - 1, 0);
  const rank = (s: Slot) => (s.next?.who === "you" ? 0 : s.next?.who === "team" ? 1 : 2);
  const byWork = (a: Slot, b: Slot) => rank(a) - rank(b) || a.date.localeCompare(b.date);

  const queue = live.filter((s) => stepsDone(s) >= IN_HAND_AFTER).sort(byWork);
  /* Everything short of the four steps, in one folded-away list. Kept on the page rather than
     dropped: a post you cannot see is a post nobody chases. */
  const rest = live.filter((s) => stepsDone(s) < IN_HAND_AFTER).sort(byWork);
  const withIdeas = rest.filter((s) => stepsDone(s) === 0 && ideasOf(s).length);

  const shown = queue.filter((s) => filter === "all" || (filter === "you" ? s.next?.who === "you" : s.next?.who !== "you"));
  const needsYou = queue.filter((s) => s.next?.who === "you").length;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>In hand</h2>
          <p className="lede">
            {queue.length
              ? <>{queue.length} post{queue.length === 1 ? " has" : "s have"} four or more steps behind {queue.length === 1 ? "it" : "them"}{needsYou ? <>, {needsYou} waiting on you</> : ", none waiting on you right now"}.</>
              : <>Nothing has four steps behind it yet. {rest.length ? `${rest.length} are further back — see below.` : "Take a topic below to start one."}</>}
          </p>
        </div>
        <Link className="btn primary" href="/">Back to calendar</Link>
      </div>
      {!slots.length ? <Empty title="No slots yet" hint="Add slots on the calendar, or press Plan the month." /> : null}

      {queue.length ? (
        <section className="panel stack" style={{ gap: 10 }}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>The queue</h3>
            <span className="actions">
              <Tabs
                tabs={[
                  { key: "all", label: "Everything", count: queue.length },
                  { key: "you", label: "Waiting on you", count: needsYou },
                  { key: "running", label: "Running", count: queue.length - needsYou },
                ]}
                active={filter} onPick={setFilter}
              />
            </span>
          </div>
          <div className="list">
            {shown.map((s) => <QueueRow key={s.id} slot={s} />)}
          </div>
          {!shown.length ? <p className="small muted" style={{ margin: 0 }}>Nothing in that state right now.</p> : null}
        </section>
      ) : null}

      {rest.length ? (
        <section className="panel stack" style={{ gap: 10 }}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Everything else</h3>
            <span className="actions">
              {withIdeas.length > 1 ? (
                <button className="btn small primary" type="button" disabled={Boolean(busy)} onClick={() => useAll(withIdeas)}>
                  {busy === "all" ? "Taking…" : `Take the first idea on all ${withIdeas.length}`}
                </button>
              ) : null}
              <button className="btn small ghost" type="button" onClick={() => setShowBacklog(!showBacklog)}>
                {showBacklog ? "Hide" : "Show"}
              </button>
              <Pill>{rest.length}</Pill>
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Fewer than {IN_HAND_AFTER} steps behind them. Folded away so the queue above stays the short list;
            each one climbs into it by itself once it has done the four.
            {withIdeas.length ? ` ChatGPT has already researched ${withIdeas.length} of them — take an idea and it starts moving.` : ""}
          </p>
          {showBacklog ? (
            <div className="list">
              {/* The ones with no topic still get the take-an-idea row, because that is the
                  decision they are waiting on. The rest are ordinary queue rows. */}
              {rest.map((s) => (stepsDone(s) === 0
                ? <TopicRow key={s.id} slot={s} busy={busy === s.id} onUse={(idea) => useIdea(s, idea)} />
                : <QueueRow key={s.id} slot={s} />))}
            </div>
          ) : null}
        </section>
      ) : null}

      {done.length ? (
        <section className="panel stack" style={{ gap: 10 }}>
          <div className="panel-head" style={{ marginBottom: 0 }}><h3>Posted</h3><Pill tone="ok">{done.length}</Pill></div>
          <div className="list">
            {done.map((s) => (
              <Link key={s.id} href={`/slot/${s.id}`} className="list-item">
                {s.final_file_id ? <img className="mini" src={fileUrl(s.final_file_id)} alt="" /> : <div className="mini empty">Text</div>}
                <div><strong>{s.topic}</strong><p>{niceDate(s.date)} · {s.platforms.join(", ")}</p></div>
                <span className="btn small ghost">View</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* One post in the queue. The meter is the point of the row: eight steps from topic to
   scheduled, filled to wherever this one has got, so "how far along" is answered by looking
   rather than by opening it. */
function QueueRow({ slot }: { slot: Slot }) {
  const step = Math.min(slot.next?.stage || slot.stage || 1, STAGE_LABELS.length);
  const who = slot.next?.who || "you";
  const ready = slot.next?.ready;
  return (
    <Link href={`/slot/${slot.id}`} className={`list-item queue-row ${ready ? "ready" : ""}`}>
      {slot.final_file_id ? <img className="mini" src={fileUrl(slot.final_file_id)} alt="" /> : <div className="mini empty">{FORMAT_LABEL[slot.format]}</div>}
      <div>
        <strong>{slot.topic || "No topic yet"}</strong>
        {/* relDay already falls back to the same short date, so showing both repeats itself. */}
        <p>{relDay(slot.date)} · {niceDate(slot.date)} · {slot.pillar_name || "No pillar"} · {slot.platforms.join(", ") || "No platform"}</p>
        <span className="meter" title={`${step - 1} of ${STAGE_LABELS.length} steps done · now on ${STAGE_LABELS[step - 1]}`}>
          {STAGE_LABELS.map((label, i) => (
            <i key={label} className={i + 1 < step ? "on" : i + 1 === step ? "at" : ""} />
          ))}
          <em>{STAGE_LABELS[step - 1]} · {step - 1} of {STAGE_LABELS.length} done</em>
        </span>
      </div>
      <span className={`next-tag who-${who}`}>{slot.next?.label || "Open"}</span>
    </Link>
  );
}

/* A post still waiting on a topic, showing the work already done for it. */
function TopicRow({ slot, busy, onUse }: { slot: Slot; busy: boolean; onUse: (idea: Idea) => void }) {
  const list = ideasOf(slot);
  const [open, setOpen] = useState(false);
  const first = list[0];
  const when = `${niceDate(slot.date)} · ${slot.pillar_name || "No pillar"} · ${slot.platforms.join(", ") || "No platform"}`;

  if (!first) {
    const thinking = slot.next?.who === "claude";
    return (
      <div className="topic-row">
        <div className="topic-main">
          <strong className="muted">{thinking ? "ChatGPT is finding ideas for this one" : "No idea yet"}</strong>
          <p>{when}</p>
        </div>
        <Link className="btn small" href={`/slot/${slot.id}`}>{thinking ? "Open" : "Choose a topic"}</Link>
      </div>
    );
  }

  return (
    <div className="topic-row has-idea">
      <div className="topic-main">
        <span className="when">{when}</span>
        <strong>{first.topic}</strong>
        {first.hook ? <p className="hook">“{first.hook}”</p> : null}
        {first.why ? <p className="why">{first.why}</p> : null}
        {first.conversation ? <p className="why src">{first.conversation}</p> : null}
        {open ? (
          <div className="other-ideas">
            {list.slice(1).map((idea) => (
              <div key={idea.topic} className="other-idea">
                <div>
                  <strong>{idea.topic}</strong>
                  {idea.why ? <p>{idea.why}</p> : null}
                </div>
                <button className="btn small" type="button" disabled={busy} onClick={() => onUse(idea)}>Take this</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="topic-actions">
        <Pill tone="info">{FORMAT_LABEL[first.format || slot.format] || first.format}</Pill>
        <button className="btn small primary" type="button" disabled={busy} onClick={() => onUse(first)}>{busy ? "Taking…" : "Take this idea"}</button>
        {list.length > 1 ? <button className="btn small ghost" type="button" onClick={() => setOpen(!open)}>{open ? "Hide" : `${list.length - 1} more`}</button> : null}
        <Link className="btn small ghost" href={`/slot/${slot.id}`}>Open</Link>
      </div>
    </div>
  );
}
