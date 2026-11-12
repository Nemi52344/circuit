"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, postJson, fmtDate } from "@/lib/api";
import { Pill, Empty, Modal, useToast } from "@/components/ui";
import { FlowCanvas } from "@/components/FlowCanvas";
import { toFlow, emptyFlow, addNode, removeNode, orphans, type Flow, type FlowNode, type NodeKind } from "@/lib/flow";

/* Routines drawn rather than listed.

   A workflow is nodes and the lines between them: Circuit's own jobs, the agents you wrote, the
   steps only a person can do, and branches that ask one question and send the run one way or the
   other. Dragging moves a node, the dot under a node starts a line, the dot on top of another
   finishes it, and clicking a line removes it.

   A run lights the nodes up as it goes, so the picture doubles as the record of what happened. */

type Workflow = { id: string; name: string; purpose: string; steps: string; trigger: string; at_time: string; weekday: number | null; builtin: number; active: number; last_run_at: string | null };
type Agent = { id: string; name: string; purpose: string };
type RunStep = { title: string; kind: string; status: "done" | "failed" | "waiting" | "skipped"; output?: unknown; error?: string; seconds?: number };
type Run = { id: string; workflow_id: string; name?: string; status: string; steps: string; started_at: string; finished_at: string | null };
type ActionDef = { key: string; label: string; note: string };
type TestDef = { key: string; label: string; yes: string; no: string };
type Data = { workflows: Workflow[]; agents: Agent[]; actions: ActionDef[]; tests: TestDef[]; runs: (Run & { name: string })[] };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const when = (w: Workflow) =>
  w.trigger === "daily" ? `Every day at ${w.at_time}`
    : w.trigger === "weekly" ? `Every ${DAYS[w.weekday ?? 1]} at ${w.at_time}`
    : "When you press Run";

export default function WorkflowsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState("");
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [askInput, setAskInput] = useState<{ wf: Workflow; text: string } | null>(null);
  const [settings, setSettings] = useState<Partial<Workflow> | null>(null);
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>("/api/workflows").then((x) => {
    setD(x);
    setPickedId((cur) => cur || x.workflows[0]?.id || null);
  }).catch((e: Error) => push(e.message, "bad")), [push]);
  useEffect(() => { load(); }, [load]);

  const picked = d?.workflows.find((w) => w.id === pickedId) || null;

  /* The board is read from whatever the workflow was saved as, and only once per workflow —
     otherwise every keystroke would throw away what is on screen. */
  useEffect(() => {
    if (!picked) { setFlow(null); return; }
    setFlow(toFlow(picked.steps));
    setDirty(false);
    setSelected(null);
    setLastRun(null);
  }, [pickedId, picked?.steps]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: Flow) => { setFlow(next); setDirty(true); };

  const save = async (f?: Flow) => {
    if (!picked) return;
    try {
      await postJson("/api/workflows", { ...picked, steps: f || flow });
      setDirty(false);
      push("Saved", "ok");
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };

  const run = async (w: Workflow, input?: Record<string, unknown>) => {
    if (dirty) await save();
    setRunning(w.id);
    setAskInput(null);
    try {
      const r = await postJson<Run>("/api/workflows", { action: "run", id: w.id, input });
      const steps = JSON.parse(r.steps || "[]") as RunStep[];
      const failed = steps.filter((s) => s.status === "failed").length;
      push(r.status === "waiting" ? "Stopped at a step that needs you" : failed ? `${failed} step${failed === 1 ? "" : "s"} failed` : `${w.name} finished`,
        r.status === "done" ? "ok" : failed ? "bad" : "");
      setLastRun(r);
      load();
    } catch (e) {
      push((e as Error).message, "bad");
    } finally { setRunning(""); }
  };

  /* The step a person had to do is done; pick the run up from there rather than starting the
     whole workflow again. */
  const carryOn = async (r: Run) => {
    setRunning(r.id);
    try {
      const out = await postJson<Run>("/api/workflows", { action: "resume", run_id: r.id });
      const steps = JSON.parse(out.steps || "[]") as RunStep[];
      const failed = steps.filter((s) => s.status === "failed").length;
      push(out.status === "waiting" ? "Stopped at the next step that needs you"
        : failed ? `${failed} step${failed === 1 ? "" : "s"} failed`
        : "Finished", out.status === "done" ? "ok" : failed ? "bad" : "");
      setLastRun(out);
      load();
    } catch (e) { push((e as Error).message, "bad"); } finally { setRunning(""); }
  };

  const start = (w: Workflow) => {
    const f = toFlow(w.steps);
    const first = f.nodes.find((n) => n.kind === "you");
    if (first && /paste|upload/i.test(first.title)) setAskInput({ wf: w, text: "" });
    else run(w);
  };

  /* A run's results, matched back onto the nodes that produced them. Titles are what the two
     sides have in common, which is good enough because a board with two identically named nodes
     is already confusing for a person. */
  const statuses = useMemo(() => {
    if (!lastRun || !flow) return undefined;
    const steps = JSON.parse(lastRun.steps || "[]") as RunStep[];
    const out: Record<string, string> = {};
    for (const n of flow.nodes) {
      const hit = steps.find((s) => s.title === n.title);
      if (hit) out[n.id] = hit.status;
    }
    return out;
  }, [lastRun, flow]);

  const add = (kind: NodeKind) => {
    if (!flow) return;
    const below = Math.max(0, ...flow.nodes.map((n) => n.y)) + 118;
    const { flow: next, id } = addNode(flow, {
      kind,
      title: kind === "branch" ? "Ask a question" : kind === "you" ? "Something only you can do" : kind === "agent" ? "Run an agent" : "Do a job",
      x: 0, y: below, ...(kind === "branch" ? { test: "found" as const } : {}),
    });
    edit(next);
    setSelected(id);
  };

  const node = flow?.nodes.find((n) => n.id === selected) || null;
  const patch = (p: Partial<FlowNode>) => {
    if (!flow || !node) return;
    edit({ ...flow, nodes: flow.nodes.map((n) => (n.id === node.id ? { ...n, ...p } : n)) });
  };

  const loose = flow ? orphans(flow) : [];

  if (!d) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Workflows</h2>
          <p className="lede">
            Routines drawn as they run. Drag a node to move it, pull a line from the dot underneath it to the dot on top of another,
            and click a line to take it away. A branch asks one question and sends the run one way or the other.
          </p>
        </div>
        <span className="actions">
          {picked ? <button className="btn" type="button" onClick={() => setSettings(picked)}>When it runs</button> : null}
          <button className="btn" type="button" onClick={async () => {
            const w = await postJson<Workflow>("/api/workflows", { name: "New workflow", purpose: "", trigger: "manual", at_time: "09:00", steps: emptyFlow() });
            setPickedId(w.id); load();
          }}>New workflow</button>
          {picked ? <button className="btn primary" type="button" disabled={Boolean(running)} onClick={() => start(picked)}>{running === picked.id ? "Running…" : "Run now"}</button> : null}
        </span>
      </div>

      <div className="wf-tabs">
        {d.workflows.map((w) => (
          <button key={w.id} type="button" className={`wf-tab ${w.id === pickedId ? "on" : ""}`} onClick={() => setPickedId(w.id)}>
            <strong>{w.name}</strong>
            <small>{when(w)}</small>
          </button>
        ))}
      </div>

      {picked && flow ? (
        <section className="panel stack" style={{ gap: 12 }}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>{picked.name}</h3>
            <span className="actions flow-bar">
              <button className="btn small" type="button" onClick={() => add("action")}>+ Job</button>
              <button className="btn small" type="button" onClick={() => add("agent")}>+ Agent</button>
              <button className="btn small" type="button" onClick={() => add("you")}>+ You</button>
              <button className="btn small" type="button" onClick={() => add("branch")}>+ Branch</button>
              <button className="btn small primary" type="button" disabled={!dirty} onClick={() => save()}>{dirty ? "Save" : "Saved"}</button>
            </span>
          </div>
          {picked.purpose ? <p className="small muted" style={{ margin: 0 }}>{picked.purpose}</p> : null}
          {loose.length ? (
            <p className="small" style={{ margin: 0, color: "#A6462F" }}>
              {loose.length} node{loose.length === 1 ? " has" : "s have"} no line into {loose.length === 1 ? "it" : "them"} — {loose.map((n) => n.title).join(", ")} will never run.
            </p>
          ) : null}

          <div className="flow-layout">
            <FlowCanvas flow={flow} onChange={edit} selected={selected} onSelect={setSelected} statuses={statuses} />
            <aside className="flow-side">
              {node ? (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="panel-head" style={{ marginBottom: 0 }}>
                    <h3>{node.kind === "trigger" ? "When it runs" : "This node"}</h3>
                    {node.kind !== "trigger" ? (
                      <button className="btn small ghost" type="button" onClick={() => { edit(removeNode(flow, node.id)); setSelected(null); }}>Remove</button>
                    ) : null}
                  </div>

                  {node.kind === "trigger" ? (
                    <p className="small muted" style={{ margin: 0 }}>{when(picked)}. Change it with “When it runs” at the top.</p>
                  ) : (
                    <>
                      <label className="field"><span>What to call it</span>
                        <input className="input" value={node.title} onChange={(e) => patch({ title: e.target.value })} />
                      </label>

                      {node.kind === "action" ? (
                        <label className="field"><span>Which job</span>
                          <select className="select" value={node.action || ""} onChange={(e) => {
                            const a = d.actions.find((x) => x.key === e.target.value);
                            patch({ action: e.target.value as FlowNode["action"], title: node.title.startsWith("Do a job") && a ? a.label : node.title });
                          }}>
                            <option value="">Choose a job…</option>
                            {d.actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                          </select>
                          {node.action ? <span className="flow-hint">{d.actions.find((a) => a.key === node.action)?.note}</span> : null}
                        </label>
                      ) : null}

                      {node.kind === "agent" ? (
                        <label className="field"><span>Which agent</span>
                          <select className="select" value={node.agent_id || ""} onChange={(e) => {
                            const a = d.agents.find((x) => x.id === e.target.value);
                            patch({ agent_id: e.target.value, title: node.title.startsWith("Run an agent") && a ? a.name : node.title });
                          }}>
                            <option value="">Choose an agent…</option>
                            {d.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </label>
                      ) : null}

                      {node.kind === "branch" ? (
                        <label className="field"><span>What it asks</span>
                          <select className="select" value={node.test || "found"} onChange={(e) => patch({ test: e.target.value as FlowNode["test"] })}>
                            {d.tests.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </select>
                          <span className="flow-hint">
                            Yes goes left, no goes right. It asks about whichever node ran straight before it.
                          </span>
                        </label>
                      ) : null}

                      {node.kind === "you" ? (
                        <label className="field"><span>What you have to do</span>
                          <textarea className="textarea" rows={4} value={node.note || ""} onChange={(e) => patch({ note: e.target.value })}
                            placeholder="The run stops here and waits until this is done." />
                        </label>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="eyebrow" style={{ margin: 0 }}>Nothing picked</div>
                  <p className="small muted" style={{ margin: 0 }}>
                    Click a node to change it. Add one with the buttons above, then drag a line from the dot under
                    one node to the dot on top of the next.
                  </p>
                  <p className="small muted" style={{ margin: 0 }}>
                    {flow.nodes.length - 1} step{flow.nodes.length === 2 ? "" : "s"} · {flow.edges.length} line{flow.edges.length === 1 ? "" : "s"}
                    {picked.last_run_at ? ` · last ran ${fmtDate(picked.last_run_at)}` : ""}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </section>
      ) : <Empty title="No workflows yet" hint="Press New workflow and draw one." />}

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>Recent runs</h3><Pill>{d.runs.length}</Pill></div>
        {d.runs.length ? (
          <div className="list">
            {d.runs.map((r) => {
              const steps = JSON.parse(r.steps || "[]") as RunStep[];
              return (
                <div key={r.id} className="list-item" style={{ cursor: "pointer" }} onClick={() => setOpenRun(r)}>
                  <div className={`dot ${r.status === "done" ? "ok" : r.status === "waiting" ? "warn" : "bad"}`} />
                  <div><strong>{r.name}</strong><p>{fmtDate(r.started_at)} · {steps.filter((s) => s.status === "done").length} of {steps.length} steps done
                    {r.status === "waiting" ? <> · waiting on “{steps.find((s) => s.status === "waiting")?.title}”</> : null}</p></div>
                  <span className="actions">
                    {r.status === "waiting" ? (
                      <button className="btn small primary" type="button" disabled={Boolean(running)}
                        onClick={(e) => { e.stopPropagation(); carryOn(r); }}>
                        {running === r.id ? "Carrying on…" : "I have done it"}
                      </button>
                    ) : null}
                    <span className="btn small ghost">See what happened</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : <Empty title="Nothing has run yet" hint="Press Run now above." />}
      </section>

      {openRun ? <RunView run={openRun} onClose={() => setOpenRun(null)} /> : null}
      {settings ? <Settings wf={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); load(); }} push={push} /> : null}
      {askInput ? (
        <Modal title={askInput.wf.name} eyebrow="This one needs something from you first" onClose={() => setAskInput(null)}>
          <div className="stack">
            <label className="field">
              <span>Paste the text (a bill, an email, anything the agent should read)</span>
              <textarea className="textarea" rows={10} value={askInput.text} onChange={(e) => setAskInput({ ...askInput, text: e.target.value })} placeholder="Paste here…" />
            </label>
            <div className="actions">
              <button className="btn primary" type="button" disabled={!askInput.text.trim()} onClick={() => run(askInput.wf, { pasted_text: askInput.text })}>Run with this</button>
              <button className="btn ghost" type="button" onClick={() => setAskInput(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ---------- name, purpose and when it runs ---------- */
function Settings({ wf, onClose, onSaved, push }: { wf: Partial<Workflow>; onClose: () => void; onSaved: () => void; push: (t: string, tone?: string) => void }) {
  const [name, setName] = useState(wf.name || "");
  const [purpose, setPurpose] = useState(wf.purpose || "");
  const [trigger, setTrigger] = useState(wf.trigger || "manual");
  const [atTime, setAtTime] = useState(wf.at_time || "09:00");
  const [weekday, setWeekday] = useState(wf.weekday ?? 1);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { push("Give it a name", "bad"); return; }
    setBusy(true);
    try {
      await postJson("/api/workflows", { ...wf, name, purpose, trigger, at_time: atTime, weekday: trigger === "weekly" ? weekday : null });
      onSaved();
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  return (
    <Modal title={wf.name || "Workflow"} eyebrow="When it runs" onClose={onClose}>
      <div className="stack">
        <div className="form-grid">
          <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>How often</span>
            <select className="select" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="manual">Only when you press Run</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </label>
          {trigger !== "manual" ? <label className="field"><span>At</span><input className="input" type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} /></label> : null}
          {trigger === "weekly" ? (
            <label className="field"><span>On</span>
              <select className="select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {DAYS.map((dn, i) => <option key={dn} value={i}>{dn}</option>)}
              </select>
            </label>
          ) : null}
          <label className="field full"><span>What it is for</span><input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="One line, so the board explains itself" /></label>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- what happened in a run ---------- */
function RunView({ run, onClose }: { run: Run; onClose: () => void }) {
  const steps = JSON.parse(run.steps || "[]") as RunStep[];
  return (
    <Modal title={run.name || "Run"} eyebrow={`${fmtDate(run.started_at)} · ${run.status}`} onClose={onClose}>
      <div className="stack">
        {steps.map((s, i) => (
          <div key={`${s.title}-${i}`} className="run-step">
            <div className="run-head">
              <span className={`dot ${s.status === "done" ? "ok" : s.status === "waiting" ? "warn" : "bad"}`} />
              <strong>{s.title}</strong>
              <span className="small muted">{s.kind === "you" ? "waiting for you" : s.seconds ? `${s.seconds}s` : s.status}</span>
            </div>
            {s.error ? <p className="small" style={{ color: "#C0473A", margin: 0 }}>{s.error}</p> : null}
            {s.output !== undefined && s.output !== null ? <Answer value={s.output} /> : null}
          </div>
        ))}
        {!steps.length ? <p className="muted">Nothing recorded.</p> : null}
      </div>
    </Modal>
  );
}

/* An agent's answer is JSON; this shows it as plain lines rather than code. */
function Answer({ value }: { value: unknown }) {
  if (typeof value === "string") return value.trim() ? <p className="small" style={{ margin: 0 }}>{value}</p> : null;
  if (Array.isArray(value)) return <ul className="work-advice">{value.map((v, i) => <li key={i}>{typeof v === "string" ? v : JSON.stringify(v)}</li>)}</ul>;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && !(Array.isArray(v) && !v.length));
    if (!entries.length) return null;
    return (
      <dl className="pic-fields">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{k.replace(/_/g, " ")}</dt>
            <dd>{Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ") : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}

