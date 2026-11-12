"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, postJson } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { useMe } from "@/components/Gate";
import { can } from "@/lib/roles";
import { pick, guessKind, mentioned, type Person } from "@/lib/allocate";
import { WorkTimeline, RANGES } from "@/components/WorkTimeline";
import { useIncoming, IncomingStrip, TeamPanel, MailPanel } from "@/components/WorkPanels";
import type { Task } from "@/lib/books";

/* The Work page: who is doing what, today.

   One lane per person, so the first thing you see is how the work is shared — and a card
   moves to someone else by dragging it there. Type a task, or paste a list, at the top and
   each line goes to the person whose work it is, with the reason on the card. Tick to finish.
   Click for everything else. The board (by status) and the timeline (by date) are the same
   tasks seen another way. */

type DoorState = { key: string; kind: "run" | "open" | "yours"; label: string; what: string; href?: string; ready: boolean; line: string };
type Member = { id: string; name: string; login: boolean; kinds: string[] };
type Data = { tasks: Task[]; statuses: string[]; areas: string[]; programme_size: number; doors: Record<string, DoorState>; team: Member[]; kinds: { key: string; label: string }[] };

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (n: number) => iso(new Date(Date.now() + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const STATUS = [
  { key: "planned", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "blocked", label: "Stuck" },
  { key: "done", label: "Done" },
];
const VIEWS = [{ key: "people", label: "People" }, { key: "board", label: "Board" }, { key: "timeline", label: "Timeline" }];
const KIND_HUE: Record<string, number> = { poster: 330, video: 265, photo: 200, print: 25, event: 45, website: 160, ads: 0, vendor: 95, reply: 185, deck: 245, report: 220, social_post: 290, other: 0 };
const ANY = "*";

/* "Today", "Tomorrow", "Late · 3d", "Fri", "12 Nov" — how a person says a date. */
function due(t: Task, today: string): { text: string; tone: "" | "late" | "today" | "soon" } {
  if (!t.end_date) return { text: "No date", tone: "" };
  const d = daysBetween(today, t.end_date);
  if (t.status !== "done" && d < 0) return { text: `Late · ${-d}d`, tone: "late" };
  if (d === 0) return { text: "Today", tone: "today" };
  if (d === 1) return { text: "Tomorrow", tone: "soon" };
  if (d > 1 && d < 7) return { text: new Date(`${t.end_date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), tone: "" };
  return { text: new Date(`${t.end_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), tone: "" };
}

const order = (today: string) => (a: Task, b: Task) => {
  const late = (t: Task) => (t.status !== "done" && t.end_date < today ? 0 : 1);
  return late(a) - late(b) || (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) || (a.end_date || "9").localeCompare(b.end_date || "9") || a.title.localeCompare(b.title);
};

const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return <span className="wk-avatar" style={{ width: size, height: size, fontSize: size * 0.42, ["--h" as string]: hueOf(name) }} aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</span>;
}

export default function WorkPage() {
  const { me } = useMe();
  const manager = can(me, "manage");
  const { push, view } = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [mode, setMode] = useState("people");
  const [range, setRange] = useState("quarter");
  const [whoseChoice, setWhose] = useState<string | null>(null);
  const whose = whoseChoice ?? (manager ? "all" : "mine");
  const [scope, setScope] = useState<"all" | "today" | "late" | "doing">("all");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [panel, setPanel] = useState<"" | "team" | "logins" | "mail">("");
  /* ?panel=team or ?panel=logins opens the drawer — old links to the Team and People pages land here. */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("panel");
    if (p === "team" || p === "logins" || p === "mail") setPanel(p);
  }, []);
  const incoming = useIncoming(push);
  /* A card you have just ticked stays a moment, struck through, so you see it go. */
  const [justDone, setJustDone] = useState<string[]>([]);
  const today = iso(new Date());

  /* The view you used last is the one you get back. */
  useEffect(() => { try { const v = localStorage.getItem("work-view"); if (v && VIEWS.some((x) => x.key === v)) setMode(v); } catch { /* private window */ } }, []);
  const pickMode = (v: string) => { setMode(v); try { localStorage.setItem("work-view", v); } catch { /* private window */ } };

  const load = useCallback(() => api<Data>("/api/work").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);
  /* Work handed out from the Inbox or by a colleague turns up without a reload. */
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && !dragId && !openId) load(); }, 20000);
    return () => clearInterval(t);
  }, [load, dragId, openId]);

  const tasks = d?.tasks || [];
  const team = d?.team || [];
  const kindLabel = useCallback((k?: string) => d?.kinds.find((x) => x.key === k)?.label || "Other", [d]);
  const isMine = useCallback((t: Task) => Boolean(me && t.assignee_id === me.id), [me]);

  /* Optimistic: the card moves the moment you let go, and the server catches up. */
  const patchLocal = (id: string, p: Partial<Task>) => setD((x) => (x ? { ...x, tasks: x.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) } : x));
  const save = async (id: string, p: Partial<Task>, done?: string) => {
    patchLocal(id, p);
    try {
      await api("/api/work", { method: "PATCH", body: JSON.stringify({ id, ...p }), headers: { "Content-Type": "application/json" } });
      if (done) push(done, "ok");
    } catch (e) { push((e as Error).message, "bad"); }
    load();
  };
  const assign = async (t: Task, to: string) => {
    if (!manager) return push("Only an Admin or a Marketing Manager can move work between people", "bad");
    if ((t.assignee_id || "") === to) return;
    const who = team.find((m) => m.id === to);
    patchLocal(t.id, { assignee_id: to, owner: who?.name || "" });
    try {
      await postJson("/api/inbox", { action: "assign", task_id: t.id, to }, "PATCH");
      push(to ? `Given to ${who?.name} — Circuit will remember who does this kind of work` : "Taken off — nobody has it now", "ok");
    } catch (e) { push((e as Error).message, "bad"); }
    load();
  };
  const toggleDone = (t: Task) => {
    if (t.status !== "done") {
      setJustDone((j) => [...j, t.id]);
      setTimeout(() => setJustDone((j) => j.filter((x) => x !== t.id)), 2200);
    }
    return save(t.id, t.status === "done" ? { status: "planned", progress: 0 } : { status: "done", progress: 100 }, t.status === "done" ? "Back on the list" : "Done ✓");
  };
  const remove = async (t: Task) => {
    if (!confirm(`Remove "${t.title}"?`)) return;
    setOpenId(null);
    setD((x) => (x ? { ...x, tasks: x.tasks.filter((y) => y.id !== t.id) } : x));
    await api(`/api/work?id=${t.id}`, { method: "DELETE" }).catch(() => null);
    push("Removed", "ok");
    load();
  };
  const press = async (t: Task) => {
    setRunning(t.id);
    try {
      const r = await postJson<{ made: string; detail: string }>("/api/work", { action: "do", id: t.id });
      push(`${r.made} — ${r.detail}`, "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setRunning(null); }
  };

  /* What is on screen: whose, which slice, the search, and whether finished work shows. */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) =>
      (whose === "all" || isMine(t))
      && (showDone || t.status !== "done" || justDone.includes(t.id) || (scope === "all" && mode === "board"))
      && (scope === "all" || (scope === "today" && t.status !== "done" && t.end_date <= today) || (scope === "late" && t.status !== "done" && t.end_date < today) || (scope === "doing" && t.status === "doing"))
      && (!needle || `${t.title} ${t.notes} ${t.owner}`.toLowerCase().includes(needle)),
    ).sort(order(today));
  }, [tasks, whose, isMine, showDone, scope, q, today, mode, justDone]);

  const open = tasks.filter((t) => t.status !== "done" && (whose === "all" || isMine(t)));
  const counts = {
    today: open.filter((t) => t.end_date <= today).length,
    late: open.filter((t) => t.end_date < today).length,
    doing: open.filter((t) => t.status === "doing").length,
    done: tasks.filter((t) => t.status === "done" && (whose === "all" || isMine(t)) && t.updated_at.slice(0, 10) >= plus(-7)).length,
  };

  /* Lanes: everyone who takes work, then whoever still has work but no longer takes it, then
     work nobody has. */
  const lanes = useMemo(() => {
    const ls: { id: string; name: string; login: boolean; kinds: string[]; tasks: Task[] }[] = team.map((m) => ({ ...m, tasks: [] }));
    for (const t of shown) {
      let lane = ls.find((l) => l.id === (t.assignee_id || ""));
      if (!lane && t.assignee_id) { lane = { id: t.assignee_id, name: t.owner || "Someone", login: true, kinds: [], tasks: [] }; ls.push(lane); }
      if (!lane) { lane = ls.find((l) => l.id === "") || (ls.push({ id: "", name: "Nobody yet", login: true, kinds: [], tasks: [] }), ls[ls.length - 1]); }
      lane.tasks.push(t);
    }
    return whose === "mine" ? ls.filter((l) => l.id === me?.id || l.tasks.length) : ls;
  }, [team, shown, whose, me]);

  const current = openId ? tasks.find((t) => t.id === openId) : undefined;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const card = (t: Task, opts: { showWho?: boolean } = {}) => {
    const dl = due(t, today);
    const door = t.door ? d?.doors[t.door] : undefined;
    return (
      <div key={t.id} className={`wk-card ${t.status === "done" ? "is-done" : ""} ${dragId === t.id ? "is-drag" : ""} ${t.priority === "high" && t.status !== "done" ? "is-urgent" : ""}`}
        draggable onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragId(null); setOver(null); }}
        onClick={() => setOpenId(t.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpenId(t.id); }}>
        <button type="button" className="wk-check" aria-label={t.status === "done" ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
          aria-pressed={t.status === "done"} onClick={(e) => { e.stopPropagation(); toggleDone(t); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
        </button>
        <div className="wk-card-body">
          <div className="wk-title">{t.title}</div>
          <div className="wk-meta">
            <span className="wk-kind" style={{ ["--h" as string]: KIND_HUE[t.kind || guessKind(t.title)] ?? 0 }}>{kindLabel(t.kind || guessKind(t.title))}</span>
            <span className={`wk-due ${dl.tone}`}>{dl.text}</span>
            {t.priority === "high" && t.status !== "done" ? <span className="wk-flag urgent">Urgent</span> : null}
            {t.status === "doing" ? <span className="wk-flag doing">Doing</span> : null}
            {t.status === "blocked" ? <span className="wk-flag stuck">Stuck</span> : null}
            {door?.kind === "run" && t.status !== "done" ? <span className="wk-flag auto" title={door.what}>Circuit can do this</span> : null}
          </div>
        </div>
        {opts.showWho ? <span title={t.owner || "Nobody yet"}><Avatar name={t.owner || "?"} size={24} /></span> : null}
      </div>
    );
  };

  const dropZone = (key: string, onDrop: (t: Task) => void) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(key); },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      const t = tasks.find((x) => x.id === id);
      setDragId(null); setOver(null);
      if (t) onDrop(t);
    },
  });

  if (!d) return <div className="stack">{view}<div className="wk-skeleton" /></div>;

  return (
    <div className="stack wk">
      {view}
      <div className="wk-head">
        <div>
          <h1>Work</h1>
          <p className="lede" style={{ margin: 0 }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {counts.today ? `${counts.today} due today or before` : "nothing due today"}{counts.late ? ` · ${counts.late} late` : ""}
          </p>
        </div>
        <div className="wk-head-right">
          <div className="seg" role="tablist" aria-label="How to see the work">
            {VIEWS.map((v) => <button key={v.key} type="button" role="tab" aria-selected={mode === v.key} className={mode === v.key ? "on" : ""} onClick={() => pickMode(v.key)}>{v.label}</button>)}
          </div>
          {manager ? <button type="button" className="btn small" onClick={() => setPanel("team")}>Team</button> : null}
          {manager ? (
            <button type="button" className="btn small" onClick={() => setPanel("mail")} title="Work by email">
              <span className={`wk-led ${incoming.d?.mail.on ? (incoming.d.mail.last && !incoming.d.mail.last.ok ? "bad" : "on") : ""}`} aria-hidden="true" /> Mail
            </button>
          ) : null}
          {manager ? <MoreMenu size={d.programme_size} onDone={load} push={push} /> : null}
        </div>
      </div>

      <QuickAdd team={team} me={me?.id || ""} kindLabel={kindLabel} onAdded={(n) => { push(n === 1 ? "Added and given out" : `${n} tasks added and given out`, "ok"); load(); }}
        onMessage={() => { push("Reading it — the tasks appear in a moment", "ok"); incoming.load(); }} push={push} />

      {incoming.d ? <IncomingStrip d={incoming.d} manager={manager} onRetry={(id) => incoming.patch({ action: "retry", id }, "Trying again")} onChanged={load} /> : null}

      <div className="wk-stats">
        {([["today", "Due today", counts.today], ["late", "Late", counts.late], ["doing", "Doing now", counts.doing]] as const).map(([k, label, n]) => (
          <button key={k} type="button" className={`wk-stat ${scope === k ? "on" : ""} ${k === "late" && n ? "warn" : ""}`} aria-pressed={scope === k} onClick={() => setScope(scope === k ? "all" : k)}>
            <strong>{n}</strong><span>{label}</span>
          </button>
        ))}
        <div className="wk-stat static"><strong>{counts.done}</strong><span>Done this week</span></div>
      </div>

      <div className="wk-filters">
        <div className="seg small">
          <button type="button" className={whose === "mine" ? "on" : ""} onClick={() => setWhose("mine")}>Mine</button>
          <button type="button" className={whose === "all" ? "on" : ""} onClick={() => setWhose("all")}>Everyone</button>
        </div>
        <input className="input wk-search" placeholder="Search work…" aria-label="Search work" value={q} onChange={(e) => setQ(e.target.value)} />
        {mode !== "board" ? <label className="wk-toggle"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label> : null}
        {mode === "timeline" ? (
          <select className="input" aria-label="How far ahead to show" value={range} onChange={(e) => setRange(e.target.value)} style={{ minHeight: 34, width: "auto" }}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        ) : null}
        {scope !== "all" ? <button type="button" className="btn small ghost" onClick={() => setScope("all")}>Clear filter ×</button> : null}
      </div>

      {mode === "people" ? (
        <div className="wk-lanes">
          {lanes.map((l) => {
            const openN = l.tasks.filter((t) => t.status !== "done").length;
            const all = tasks.filter((t) => (t.assignee_id || "") === l.id);
            const doneN = all.filter((t) => t.status === "done").length;
            return (
              <section key={l.id || "none"} className={`wk-lane ${over === `lane:${l.id}` ? "is-over" : ""} ${l.id === me?.id ? "is-me" : ""}`} {...dropZone(`lane:${l.id}`, (t) => assign(t, l.id))} aria-label={`${l.name}'s work`}>
                <header className="wk-lane-head">
                  {l.id ? <Avatar name={l.name} /> : <span className="wk-avatar none" aria-hidden="true">?</span>}
                  <div className="wk-lane-who">
                    <strong>{l.name}{l.id === me?.id ? " (you)" : ""}</strong>
                    <span>{l.id === "" ? "Drag a card onto a person" : l.kinds.includes(ANY) ? `Everything else${l.kinds.length > 1 ? ` + ${l.kinds.filter((k) => k !== ANY).map(kindLabel).join(", ")}` : ""}` : l.kinds.length ? l.kinds.map(kindLabel).join(", ") : "Any work"}{!l.login ? " · no login yet" : ""}</span>
                  </div>
                  <span className="wk-count" title={`${openN} open`}>{openN}</span>
                </header>
                {all.length ? <div className="wk-progress" title={`${doneN} of ${all.length} done`}><i style={{ width: `${(doneN / all.length) * 100}%` }} /></div> : null}
                <div className="wk-lane-body">
                  {l.tasks.length ? l.tasks.map((t) => card(t)) : <p className="wk-empty">{scope === "all" && !q ? "Nothing on. Drag work here, or add some above." : "Nothing here for this filter."}</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : mode === "board" ? (
        <div className="wk-board">
          {STATUS.map((s) => {
            const col = shown.filter((t) => t.status === s.key);
            return (
              <section key={s.key} className={`wk-col ${over === `col:${s.key}` ? "is-over" : ""}`} {...dropZone(`col:${s.key}`, (t) => t.status !== s.key && save(t.id, { status: s.key, ...(s.key === "done" ? { progress: 100 } : {}) }, `Moved to ${s.label}`))}>
                <header className="wk-col-head"><span className={`wk-dot s-${s.key}`} />{s.label}<span className="wk-count">{col.length}</span></header>
                <div className="wk-lane-body">{col.length ? col.map((t) => card(t, { showWho: true })) : <p className="wk-empty">Drop work here</p>}</div>
              </section>
            );
          })}
        </div>
      ) : (
        shown.length ? <WorkTimeline tasks={shown} range={range} onOpen={setOpenId} /> : <Empty title="Nothing to chart" hint="Add work above, or clear the filter." />
      )}

      {(panel === "team" || panel === "logins") && incoming.d ? (
        <TeamPanel d={incoming.d} patch={(b, m) => { incoming.patch(b, m); setTimeout(load, 400); }} onClose={() => setPanel("")}
          logins={can(me, "people")} start={panel === "logins" ? "logins" : "work"} />
      ) : null}
      {panel === "mail" && incoming.d ? <MailPanel d={incoming.d} patch={incoming.patch} push={push} reload={incoming.load} onClose={() => setPanel("")} /> : null}

      {current ? (
        <Drawer t={current} team={team} kinds={d.kinds} manager={manager} door={current.door ? d.doors[current.door] : undefined} running={running === current.id}
          onClose={() => setOpenId(null)} onSave={(p, msg) => save(current.id, p, msg)} onAssign={(to) => assign(current, to)} onRemove={() => remove(current)} onPress={() => press(current)} today={today} />
      ) : null}
    </div>
  );
}

/* ---- adding work: type a task or paste a list ---- */

function QuickAdd({ team, me, kindLabel, onAdded, onMessage, push }: { team: Member[]; me: string; kindLabel: (k?: string) => string; onAdded: (n: number) => void; onMessage: () => void; push: (t: string, tone?: string) => void }) {
  /* Two ways in. "Tasks": each line already is a task. "Message": a WhatsApp or an email as it
     came, which ChatGPT reads into however many tasks it holds. */
  const [mode, setMode] = useState<"tasks" | "message">("tasks");
  const [sender, setSender] = useState("");
  const [text, setText] = useState("");
  const [who, setWho] = useState("auto");
  const [when, setWhen] = useState("today");
  const [date, setDate] = useState(plus(0));
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  /* "/" from anywhere on the page puts you in the box. */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") { e.preventDefault(); box.current?.focus(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const rowsFor = mode === "message" ? 6 : 1;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(\(?\d{1,3}[).:]|[-*•·]|\[\s?\])\s*/, "").trim()).filter((l) => l.length > 1);
  /* Who each line would go to, worked out here with the same rule the server uses — so you see
     the split before you press Add. (The server also counts history; this preview does not.) */
  const people: Person[] = team.map((m) => ({ id: m.id, name: m.name, email: "", takes_work: true, kinds: m.kinds }));
  const empty = { done: {}, movedTo: {}, movedFrom: {}, open: {} };
  const preview = lines.slice(0, 12).map((l) => {
    const k = guessKind(l);
    const to = who === "auto" ? pick(k, people, empty, mentioned(l, people)).choice?.name : team.find((m) => m.id === who)?.name;
    return { l, k, to };
  });
  const dueDate = when === "today" ? plus(0) : when === "tomorrow" ? plus(1) : when === "week" ? plus(Math.max(1, 5 - new Date().getDay())) : date;

  const read = async () => {
    if (text.trim().length < 4) { box.current?.focus(); return; }
    setBusy(true);
    try {
      await postJson("/api/inbox", { text, sender });
      setText(""); setSender("");
      onMessage();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  const add = async () => {
    if (mode === "message") return read();
    if (!lines.length) { box.current?.focus(); return; }
    setBusy(true);
    try {
      const r = await postJson<{ tasks: Task[] }>("/api/work", { action: "quick", text, assignee: who, due: dueDate, priority: urgent ? "high" : "normal" });
      setText(""); setUrgent(false);
      onAdded(r.tasks.length);
      box.current?.focus();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  return (
    <div className={`wk-add ${text ? "is-active" : ""}`}>
      <div className="wk-add-tabs" role="tablist" aria-label="What you are adding">
        <button type="button" role="tab" aria-selected={mode === "tasks"} className={mode === "tasks" ? "on" : ""} onClick={() => { setMode("tasks"); box.current?.focus(); }}>Tasks</button>
        <button type="button" role="tab" aria-selected={mode === "message"} className={mode === "message" ? "on" : ""} onClick={() => { setMode("message"); box.current?.focus(); }}>Paste a message</button>
      </div>
      <div className="wk-add-main">
        <span className="wk-add-plus" aria-hidden="true">+</span>
        <textarea ref={box} rows={mode === "message" && text ? rowsFor : Math.min(Math.max(lines.length, 1), 6)} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (mode === "tasks" && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }}
          placeholder={mode === "tasks" ? "Add work — type a task, or paste a list (one per line)" : "Paste a WhatsApp, an email or meeting notes as it is — Circuit finds the tasks in it"}
          aria-label="Add work" />
      </div>
      {text && mode === "message" ? (
        <div className="wk-add-row">
          <label className="wk-add-field"><span>From</span>
            <input className="input" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="who sent it (optional)" style={{ minWidth: 200 }} />
          </label>
          <span className="small muted">ChatGPT reads it — about half a minute</span>
          <button type="button" className="btn primary" disabled={busy || text.trim().length < 4} onClick={read}>{busy ? "Sending…" : "Read it and give out the tasks"}</button>
        </div>
      ) : null}
      {text && mode === "tasks" ? (
        <>
          <p className="wk-add-hint">Enter adds · Shift+Enter starts a new line · press / from anywhere to come back here</p>
          {preview.length ? (
            <ul className="wk-preview" aria-label="Who each line goes to">
              {preview.map((p, i) => (
                <li key={i}><span className="wk-preview-t">{p.l}</span><span className="wk-kind" style={{ ["--h" as string]: KIND_HUE[p.k] ?? 0 }}>{kindLabel(p.k)}</span><span className="wk-arrow">→</span><strong>{p.to || "nobody yet"}</strong></li>
              ))}
              {lines.length > 12 ? <li className="muted">…and {lines.length - 12} more</li> : null}
            </ul>
          ) : null}
          <div className="wk-add-row">
            <label className="wk-add-field"><span>Give to</span>
              <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="auto">Circuit decides</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === me ? " (me)" : ""}</option>)}
              </select>
            </label>
            <div className="seg small" role="group" aria-label="When it is due">
              {[["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["date", "Date…"]].map(([k, l]) => (
                <button key={k} type="button" className={when === k ? "on" : ""} onClick={() => setWhen(k)}>{l}</button>
              ))}
            </div>
            {when === "date" ? <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Due date" style={{ minHeight: 34, width: "auto" }} /> : null}
            <button type="button" className={`chip ${urgent ? "on" : ""}`} aria-pressed={urgent} onClick={() => setUrgent(!urgent)}>Urgent</button>
            <button type="button" className="btn primary" disabled={busy || !lines.length} onClick={add}>{busy ? "Adding…" : lines.length > 1 ? `Add ${lines.length} tasks` : "Add"}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ---- one task, everything about it ---- */

function Drawer({ t, team, kinds, manager, door, running, today, onClose, onSave, onAssign, onRemove, onPress }: {
  t: Task; team: Member[]; kinds: { key: string; label: string }[]; manager: boolean; door?: DoorState; running: boolean; today: string;
  onClose: () => void; onSave: (p: Partial<Task>, msg?: string) => void; onAssign: (to: string) => void; onRemove: () => void; onPress: () => void;
}) {
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes || "");
  useEffect(() => { setTitle(t.title); setNotes(t.notes || ""); }, [t.id, t.title, t.notes]);
  const dl = due(t, today);
  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className="wk-drawer" role="dialog" aria-label={t.title}>
        <div className="wk-drawer-head">
          <button type="button" className={`wk-check big ${t.status === "done" ? "on" : ""}`} aria-pressed={t.status === "done"} aria-label="Done"
            onClick={() => onSave(t.status === "done" ? { status: "planned", progress: 0 } : { status: "done", progress: 100 }, t.status === "done" ? "Back on the list" : "Done ✓")}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
          </button>
          <input className="wk-drawer-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="What it is"
            onBlur={() => title.trim() && title !== t.title && onSave({ title: title.trim() }, "Renamed")} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <button type="button" className="tb-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="seg wide" role="group" aria-label="How it is going">
          {STATUS.map((s) => <button key={s.key} type="button" className={t.status === s.key ? "on" : ""} onClick={() => onSave({ status: s.key, ...(s.key === "done" ? { progress: 100 } : {}) })}>{s.label}</button>)}
        </div>

        <div className="wk-drawer-grid">
          <label className="field"><span>Who has it</span>
            {manager ? (
              <select className="input" value={t.assignee_id || ""} onChange={(e) => onAssign(e.target.value)}>
                <option value="">Nobody yet</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.login ? "" : " (no login yet)"}</option>)}
              </select>
            ) : <div className="wk-static"><Avatar name={t.owner || "?"} size={22} /> {t.owner || "Nobody yet"}</div>}
          </label>
          <label className="field"><span>Due <em className={dl.tone === "late" ? "bad-text" : ""}>{dl.text}</em></span>
            <input className="input" type="date" value={t.end_date || ""} onChange={(e) => e.target.value && onSave({ end_date: e.target.value, ...(t.start_date > e.target.value ? { start_date: e.target.value } : {}) }, "Date changed")} />
          </label>
          <label className="field"><span>Kind of work</span>
            <select className="input" value={t.kind || guessKind(t.title)} onChange={(e) => onSave({ kind: e.target.value })}>
              {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Priority</span>
            <div className="seg small">
              {[["high", "Urgent"], ["normal", "Normal"], ["low", "Low"]].map(([k, l]) => <button key={k} type="button" className={(t.priority || "normal") === k ? "on" : ""} onClick={() => onSave({ priority: k })}>{l}</button>)}
            </div>
          </label>
        </div>

        {t.assign_reason ? <p className="wk-why"><strong>Why {t.owner || "nobody"}:</strong> {t.assign_reason}</p> : null}

        {door ? (
          <div className="note stack" style={{ gap: 8 }}>
            <div><strong className="small">{door.kind === "run" ? "Circuit can do this" : "Where this is done"}</strong><div className="small muted">{door.what}</div></div>
            <div className="small">{door.ready ? door.line : <span className="bad-text">{door.line}</span>}</div>
            <div className="actions">
              {door.kind === "run"
                ? <button className="btn small primary" type="button" disabled={!door.ready || running} onClick={onPress}>{running ? "Working…" : door.label}</button>
                : door.href ? <Link className="btn small primary" href={door.href}>{door.label}</Link> : null}
            </div>
          </div>
        ) : null}

        <label className="field"><span>Notes</span>
          <textarea className="textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Links, sizes, who to send it to…"
            onBlur={() => notes !== (t.notes || "") && onSave({ notes }, "Notes saved")} />
        </label>

        <details className="wk-more">
          <summary>More detail</summary>
          <div className="wk-drawer-grid">
            <label className="field"><span>Starts</span><input className="input" type="date" value={t.start_date || ""} onChange={(e) => e.target.value && onSave({ start_date: e.target.value })} /></label>
            <label className="field"><span>How far along · {t.progress}%</span><input type="range" min={0} max={100} step={10} value={t.progress} onChange={(e) => onSave({ progress: Number(e.target.value) })} /></label>
            <label className="field"><span>Should take (minutes)</span><input className="input" type="number" min={0} defaultValue={t.estimate_minutes || ""} onBlur={(e) => onSave({ estimate_minutes: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="field"><span>Took (minutes)</span><input className="input" type="number" min={0} defaultValue={t.spent_minutes || ""} onBlur={(e) => onSave({ spent_minutes: Math.max(0, Number(e.target.value) || 0) })} /></label>
          </div>
        </details>

        <div className="wk-drawer-foot">
          <button type="button" className="btn small ghost" onClick={onRemove}>Remove</button>
          <button type="button" className="btn small" onClick={onClose}>Close</button>
        </div>
      </aside>
    </>
  );
}

/* ---- the two board-filling actions, out of the way ---- */

function MoreMenu({ size, onDone, push }: { size: number; onDone: () => void; push: (t: string, tone?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const fill = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ added: Task[]; updated: Task[] }>("/api/work", { action: "fill" });
      push(r.added.length || r.updated.length ? `${r.added.length} added, ${r.updated.length} brought up to date` : "Already up to date", "ok");
      onDone();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const programme = async () => {
    if (!confirm(`Put ${size || "the"} standard pieces of marketing work on the board? Anything already there with the same name is left alone.`)) return;
    setBusy(true);
    try {
      const r = await postJson<{ added: number; skipped: number }>("/api/work", { action: "programme" });
      push(r.added ? `${r.added} added` : "All of it is already on the board", "ok");
      onDone();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  return (
    <details className="wk-menu">
      <summary className="tb-btn" aria-label="More ways to fill the board">⋯</summary>
      <div className="wk-menu-pop">
        <button type="button" disabled={busy} onClick={fill}><strong>Fill from what&apos;s happening</strong><span>The calendar&apos;s posts and what Circuit has flagged</span></button>
        <button type="button" disabled={busy} onClick={programme}><strong>Add the standard list</strong><span>The marketing work Circuit can help with</span></button>
      </div>
    </details>
  );
}
