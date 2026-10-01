"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fmtDay } from "@/lib/api";
import { Pill, Empty, Modal, useToast } from "@/components/ui";

/* What Circuit thinks it should become next.

   It reads its own specification and its own health, then proposes the next few pieces of work
   with a plan concrete enough to hand to whoever writes the code. It stops at the plan: the app
   does not edit itself. You decide what happens, and the code is written with someone watching. */

type Item = {
  id: string; title: string; why: string; kind: string; requirement: string;
  plan: string; files: string; risk: string; acceptance: string; effort: string;
  status: "proposed" | "next" | "doing" | "done" | "dropped"; notes: string; created_at: string;
};
type Data = { items: Item[]; built: number; unbuilt: number; problems: string[]; size: Record<string, number> };

const LANES: { key: Item["status"]; label: string; note: string }[] = [
  { key: "proposed", label: "Suggested", note: "Circuit thinks these are worth doing" },
  { key: "next", label: "Agreed", note: "You said yes; not started" },
  { key: "doing", label: "Being built", note: "Someone is on it" },
  { key: "done", label: "Built", note: "" },
];

export default function BuildPage() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [handoff, setHandoff] = useState("");
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>("/api/roadmap").then(setD).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const propose = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ items: Item[] }>("/api/roadmap", { action: "propose" });
      push(r.items.length ? `${r.items.length} suggested` : "Nothing worth proposing right now", r.items.length ? "ok" : "");
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const move = async (item: Item, status: Item["status"]) => {
    await postJson("/api/roadmap", { action: "status", id: item.id, status });
    if (open?.id === item.id) setOpen({ ...item, status });
    load();
  };

  const copyPlan = async (item: Item) => {
    const r = await api<{ text: string }>(`/api/roadmap?handoff=${item.id}`);
    setHandoff(r.text);
    navigator.clipboard.writeText(r.text).then(() => push("Plan copied — paste it into a Claude Code session", "ok")).catch(() => null);
  };

  if (!d) return <p className="muted">Loading…</p>;
  const lanes = LANES.map((l) => ({ ...l, items: d.items.filter((i) => i.status === l.key) }));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>What to build next</h2>
          <p className="lede">
            Circuit reads its own specification and its own health, then says what is worth building next
            and how. It writes the plan; it does not write itself — you decide, and the code is written with someone watching.
          </p>
        </div>
        <button className="btn primary" type="button" disabled={busy} onClick={propose}>{busy ? "Thinking…" : "Ask what's next"}</button>
      </div>

      <div className="know-counts">
        <div className="kpi"><strong>{d.built}</strong><small>requirements built</small><span>of {d.built + d.unbuilt} written down</span></div>
        <div className="kpi"><strong>{d.unbuilt}</strong><small>still to build</small><span>from docs/PRD.html</span></div>
        <div className="kpi"><strong>{d.problems.length}</strong><small>things not right</small><span>{d.problems[0]?.split(":")[0] || "nothing flagged"}</span></div>
        <div className="kpi"><strong>{d.size.posts}</strong><small>posts planned</small><span>{d.size.knowledge} facts known · {d.size.own_posts} of your posts read</span></div>
      </div>

      {lanes.map((l) => (
        l.items.length ? (
          <section key={l.key} className="panel stack" style={{ gap: 12 }}>
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <h3>{l.label}</h3>
              <span className="actions">{l.note ? <span className="small muted">{l.note}</span> : null}<Pill>{l.items.length}</Pill></span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {l.items.map((i) => (
                <article key={i.id} className="fact" onClick={() => setOpen(i)} style={{ cursor: "pointer" }}>
                  <div className="fact-top">
                    <Pill tone={i.kind === "fix" ? "warn" : i.kind === "polish" ? "" : "ok"}>{i.kind}</Pill>
                    {i.requirement ? <Pill>{i.requirement}</Pill> : null}
                    {i.effort ? <span className="small muted">{i.effort}</span> : null}
                    <span className="small muted">{fmtDay(i.created_at)}</span>
                  </div>
                  <strong>{i.title}</strong>
                  {i.why ? <p>{i.why}</p> : null}
                  <div className="fact-foot" onClick={(e) => e.stopPropagation()}>
                    {i.status === "proposed" ? (
                      <>
                        <button className="btn small primary" type="button" onClick={() => move(i, "next")}>Yes, build it</button>
                        <button className="btn small ghost" type="button" onClick={() => move(i, "dropped")}>Not this</button>
                      </>
                    ) : null}
                    {i.status === "next" ? (
                      <>
                        <button className="btn small primary" type="button" onClick={() => copyPlan(i)}>Copy the plan</button>
                        <button className="btn small" type="button" onClick={() => move(i, "doing")}>Started</button>
                      </>
                    ) : null}
                    {i.status === "doing" ? <button className="btn small primary" type="button" onClick={() => move(i, "done")}>Built</button> : null}
                    <button className="btn small ghost" type="button" onClick={() => setOpen(i)}>The plan</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null
      ))}

      {!d.items.length ? <Empty title="Nothing on the board" hint="Press Ask what's next. Circuit will read its own spec and health and suggest three things." /> : null}

      {open ? (
        <Modal title={open.title} eyebrow={`${open.kind}${open.requirement ? ` · ${open.requirement}` : ""}${open.effort ? ` · ${open.effort}` : ""}`} onClose={() => setOpen(null)}>
          <div className="stack">
            {open.notes ? <p className="small muted" style={{ margin: 0 }}>{open.notes}</p> : null}
            {open.why ? <p style={{ margin: 0 }}>{open.why}</p> : null}
            <div className="eyebrow" style={{ marginBottom: 0 }}>The plan</div>
            <div className="pic-caption">{open.plan}</div>
            {open.risk ? <><div className="eyebrow" style={{ marginBottom: 0 }}>What could break</div><p className="small" style={{ margin: 0 }}>{open.risk}</p></> : null}
            {open.acceptance ? <><div className="eyebrow" style={{ marginBottom: 0 }}>Done when</div><p className="small" style={{ margin: 0 }}>{open.acceptance}</p></> : null}
            <div className="actions">
              <button className="btn primary" type="button" onClick={() => copyPlan(open)}>Copy the plan for a developer</button>
              {open.status === "proposed" ? <button className="btn" type="button" onClick={() => { move(open, "next"); }}>Yes, build it</button> : null}
              {open.status !== "dropped" ? <button className="btn ghost" type="button" onClick={() => { move(open, "dropped"); setOpen(null); }}>Drop it</button> : null}
            </div>
            {handoff ? <><div className="eyebrow" style={{ marginBottom: 0 }}>Copied</div><div className="pic-caption">{handoff}</div></> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
