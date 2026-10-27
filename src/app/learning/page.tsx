"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";

/* Tests for the marketing team: how our platform works, what the platforms changed, and the
   craft itself. Everybody can take one. The Manager and the Admin also see how the team is
   doing and keep the question bank — including passing the questions ChatGPT drafts. */

type Kind = "circuit" | "platforms" | "marketing";
type Asked = { id: string; kind: Kind; topic: string; question: string; options: string[] };
type Marked = Asked & { chose: number; answer: number; right: boolean; why: string };
type Question = Asked & { answer: number; why: string; source: string; status: "live" | "draft" | "retired"; created_at: string };
type Module = { n: number; name: string; page: string; auto: "full" | "partial" | "manual"; does: string; person: string };
type Data = {
  kinds: { kind: Kind; label: string; what: string }[];
  size: number; pass: number; counts: Record<Kind, number>; modules: Module[];
  mine: { id: string; kind: string; score: number; total: number; finished_at: string }[];
  can_manage: boolean;
  team: { user_id: string; name: string; tests: number; last: number; average: number; last_at: string; weakest: string[] }[] | null;
  bank: Question[] | null;
};
type Result = { score: number; total: number; percent: number; passed: boolean; marked: Marked[] };

const pct = (s: number, t: number) => (t ? Math.round((s / t) * 100) : 0);
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const AUTO = { full: "Runs by itself", partial: "Circuit does it when asked", manual: "Kept by a person" } as const;

export default function LearningPage() {
  const [d, setD] = useState<Data | null>(null);
  const [test, setTest] = useState<{ attempt: string; questions: Asked[] } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState("");
  const [gen, setGen] = useState<{ kind: Kind; topic: string; count: number }>({ kind: "platforms", topic: "", count: 5 });
  const [bankView, setBankView] = useState<"draft" | "live" | "retired">("draft");
  const { push: toast, view } = useToast();

  const load = useCallback(() => api<Data>("/api/learning").then(setD).catch((e) => toast((e as Error).message)), [toast]);
  useEffect(() => { load(); }, [load]);

  async function start(kind: string) {
    setBusy(kind); setResult(null);
    try {
      const t = await postJson<{ attempt: string; questions: Asked[] }>("/api/learning", { action: "start", kind });
      setTest(t); setAnswers(t.questions.map(() => -1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { toast((e as Error).message); }
    setBusy("");
  }

  async function handIn() {
    if (!test) return;
    setBusy("submit");
    try {
      const r = await postJson<Result>("/api/learning", { action: "submit", attempt: test.attempt, answers });
      setResult(r); setTest(null); load();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { toast((e as Error).message); }
    setBusy("");
  }

  async function generate() {
    setBusy("generate");
    try {
      const r = await postJson<{ made: Question[] }>("/api/learning", { action: "generate", ...gen }, "PATCH");
      toast(`${r.made.length} new questions are waiting for you to pass them`); setBankView("draft"); load();
    } catch (e) { toast((e as Error).message); }
    setBusy("");
  }

  async function mark(id: string, action: "live" | "retired") {
    try { await postJson("/api/learning", { action, id }, "PATCH"); load(); }
    catch (e) { toast((e as Error).message); }
  }

  if (!d) return <div className="stack">{view}<p className="muted">Loading…</p></div>;
  const done = d.mine.length;
  const last = d.mine[0];
  const avg = done ? Math.round(d.mine.reduce((s, a) => s + pct(a.score, a.total), 0) / done) : 0;
  const answered = answers.filter((a) => a >= 0).length;
  const labelOf = (k: string) => d.kinds.find((x) => x.kind === k)?.label || "Mixed";

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Learning</h2>
          <p className="lede">
            Short tests of {d.size} questions on how Circuit works, what Instagram, LinkedIn and X have changed lately,
            and the craft of marketing. {d.pass}% passes. Every answer comes with the reason.
          </p>
        </div>
      </div>

      <div className="grid-cards">
        <div className="kpi"><strong>{done}</strong><small>tests taken</small><span>{done ? `last on ${day(last.finished_at)}` : "none yet"}</span></div>
        <div className={`kpi ${last && pct(last.score, last.total) >= d.pass ? "deep" : ""}`}><strong>{last ? `${pct(last.score, last.total)}%` : "—"}</strong><small>last score</small><span>{last ? labelOf(last.kind) : "take one below"}</span></div>
        <div className="kpi"><strong>{done ? `${avg}%` : "—"}</strong><small>your average</small><span>across every test</span></div>
        <div className="kpi"><strong>{d.counts.circuit + d.counts.platforms + d.counts.marketing}</strong><small>questions in the bank</small><span>live and passed</span></div>
      </div>

      {/* ---- the result of the test just handed in ---- */}
      {result ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>{result.score} of {result.total} — {result.percent}%</h3>
            <Pill tone={result.passed ? "ok" : "warn"}>{result.passed ? "Passed" : `Below ${d.pass}% — try again`}</Pill>
          </div>
          <ol className="quiz">
            {result.marked.map((m) => (
              <li key={m.id} className={m.right ? "right" : "wrong"}>
                <p className="eyebrow">{labelOf(m.kind)} · {m.topic}</p>
                <strong>{m.question}</strong>
                <ul>
                  {m.options.map((o, i) => (
                    <li key={i} className={i === m.answer ? "key" : i === m.chose ? "picked" : ""}>
                      {o}{i === m.answer ? " ✓" : i === m.chose ? " — your answer" : ""}
                    </li>
                  ))}
                </ul>
                <p className="small muted">{m.why}</p>
              </li>
            ))}
          </ol>
          <span className="actions"><button className="btn" type="button" onClick={() => setResult(null)}>Done</button></span>
        </section>
      ) : null}

      {/* ---- a test in progress ---- */}
      {test ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>Your test</h3>
            <span className="muted small">{answered} of {test.questions.length} answered</span>
          </div>
          <ol className="quiz">
            {test.questions.map((q, n) => (
              <li key={q.id}>
                <p className="eyebrow">{labelOf(q.kind)} · {q.topic}</p>
                <strong>{q.question}</strong>
                <ul>
                  {q.options.map((o, i) => (
                    <li key={i}>
                      <label className={answers[n] === i ? "on" : ""}>
                        <input type="radio" name={q.id} checked={answers[n] === i}
                          onChange={() => setAnswers((a) => a.map((v, j) => (j === n ? i : v)))} />
                        {o}
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <span className="actions">
            <button className="btn ghost" type="button" onClick={() => setTest(null)}>Leave it</button>
            <button className="btn primary" type="button" disabled={answered < test.questions.length || busy === "submit"} onClick={handIn}>
              {busy === "submit" ? "Marking…" : "Hand it in"}
            </button>
          </span>
        </section>
      ) : null}

      {/* ---- choose a test ---- */}
      {!test ? (
        <section className="panel stack">
          <div className="panel-head"><h3>Take a test</h3><span className="muted small">Questions you have not seen come first</span></div>
          <div className="grid-cards">
            {d.kinds.map((k) => (
              <div key={k.kind} className="kpi" style={{ gap: 10 }}>
                <strong style={{ fontSize: 20 }}>{k.label}</strong>
                <small>{k.what}</small>
                <span>{d.counts[k.kind]} questions</span>
                <button className="btn small" type="button" style={{ order: 3, alignSelf: "flex-start" }}
                  disabled={!d.counts[k.kind] || Boolean(busy)} onClick={() => start(k.kind)}>
                  {busy === k.kind ? "Starting…" : d.counts[k.kind] ? "Start" : "No questions yet"}
                </button>
              </div>
            ))}
            <div className="kpi deep" style={{ gap: 10 }}>
              <strong style={{ fontSize: 20 }}>A bit of everything</strong>
              <small>Mixed from all three</small>
              <span>{d.size} questions</span>
              <button className="btn small primary" type="button" style={{ order: 3, alignSelf: "flex-start" }} disabled={Boolean(busy)} onClick={() => start("mixed")}>
                {busy === "mixed" ? "Starting…" : "Start"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- what to read before the platform test ---- */}
      <details className="panel">
        <summary><strong>Read first: what Circuit does, line by line</strong> <span className="muted small">— the platform questions come from this</span></summary>
        <div className="list" style={{ marginTop: 14 }}>
          {d.modules.map((m) => (
            <div key={m.n} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
              <div><strong>{m.n}. {m.name}</strong><p>{m.does} <span className="muted">A person: {m.person}</span></p></div>
              <Pill tone={m.auto === "full" ? "ok" : m.auto === "partial" ? "info" : "warn"}>{AUTO[m.auto]}</Pill>
            </div>
          ))}
        </div>
      </details>

      {done ? (
        <section className="panel stack">
          <div className="panel-head"><h3>Your tests</h3></div>
          <div className="list">
            {d.mine.map((a) => (
              <div key={a.id} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><strong>{labelOf(a.kind)}</strong><p>{day(a.finished_at)}</p></div>
                <Pill tone={pct(a.score, a.total) >= d.pass ? "ok" : "warn"}>{a.score}/{a.total} · {pct(a.score, a.total)}%</Pill>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- the Manager's and the Admin's view ---- */}
      {d.can_manage && d.team ? (
        <section className="panel stack">
          <div className="panel-head"><h3>The team</h3><span className="muted small">Weakest topics are where most answers went wrong</span></div>
          {d.team.length ? (
            <div className="list">
              {d.team.map((p) => (
                <div key={p.user_id} className="list-item" style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <div><strong>{p.name}</strong><p>{p.tests} test{p.tests === 1 ? "" : "s"} · last {day(p.last_at)}{p.weakest.length ? ` · weakest: ${p.weakest.join(", ")}` : ""}</p></div>
                  <span className="small muted">avg {p.average}%</span>
                  <Pill tone={p.last >= d.pass ? "ok" : "warn"}>last {p.last}%</Pill>
                </div>
              ))}
            </div>
          ) : <Empty title="Nobody has taken a test yet" />}
        </section>
      ) : null}

      {d.can_manage && d.bank ? (
        <section className="panel stack">
          <div className="panel-head"><h3>Question bank</h3><span className="muted small">ChatGPT's questions wait here until you pass them</span></div>
          <div className="actions" style={{ flexWrap: "wrap", gap: 8 }}>
            <select className="input" aria-label="Kind of question" value={gen.kind} style={{ width: "auto", minHeight: 38 }}
              onChange={(e) => setGen({ ...gen, kind: e.target.value as Kind })}>
              {d.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <input className="input" placeholder="Focus (optional) — e.g. Instagram Reels, B2B funnels" value={gen.topic} style={{ flex: 1, minWidth: 220 }}
              onChange={(e) => setGen({ ...gen, topic: e.target.value })} />
            <select className="input" aria-label="How many" value={gen.count} style={{ width: "auto", minHeight: 38 }}
              onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })}>
              {[3, 5, 10].map((n) => <option key={n} value={n}>{n} questions</option>)}
            </select>
            <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={generate}>
              {busy === "generate" ? "Writing — a few minutes…" : "Write new questions"}
            </button>
          </div>
          <div className="seg" role="group" aria-label="Which questions">
            {(["draft", "live", "retired"] as const).map((s) => (
              <button key={s} type="button" className={`seg-btn ${bankView === s ? "on" : ""}`} aria-pressed={bankView === s} onClick={() => setBankView(s)}>
                {s === "draft" ? "Waiting" : s === "live" ? "In use" : "Retired"} ({d.bank!.filter((q) => q.status === s).length})
              </button>
            ))}
          </div>
          {d.bank.filter((q) => q.status === bankView).length ? (
            <ol className="quiz">
              {d.bank.filter((q) => q.status === bankView).map((q) => (
                <li key={q.id}>
                  <p className="eyebrow">{labelOf(q.kind)} · {q.topic} · {q.source}</p>
                  <strong>{q.question}</strong>
                  <ul>{q.options.map((o, i) => <li key={i} className={i === q.answer ? "key" : ""}>{o}{i === q.answer ? " ✓" : ""}</li>)}</ul>
                  <p className="small muted">{q.why}</p>
                  <span className="actions">
                    {q.status !== "live" ? <button className="btn small primary" type="button" onClick={() => mark(q.id, "live")}>{q.status === "draft" ? "Pass it" : "Use again"}</button> : null}
                    {q.status !== "retired" ? <button className="btn small ghost" type="button" onClick={() => mark(q.id, "retired")}>{q.status === "draft" ? "Throw out" : "Retire"}</button> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : <Empty title={bankView === "draft" ? "Nothing waiting" : "None here"} hint={bankView === "draft" ? "Write new questions above — they land here first." : undefined} />}
        </section>
      ) : null}
    </div>
  );
}
