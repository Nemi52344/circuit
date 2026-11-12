"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";

/* Learning: a marketing course for somebody new to it, and the tests.

   The course is four levels — Basics, Normal, Hard, Advanced — of six short lessons each. A
   lesson is three to five minutes of reading and a three-question check; each level ends in a
   ten-question test. Progress is read from the checks and tests a person has handed in, so
   there is nothing to tick by hand. Below the course sit the practice tests (our platform,
   platform updates, the craft), and for the Manager and the Admin, the team and the bank. */

type Kind = "circuit" | "platforms" | "marketing";
type Asked = { id: string; kind: Kind; topic: string; question: string; options: string[] };
type Marked = Asked & { chose: number; answer: number; right: boolean; why: string };
type Question = Asked & { answer: number; why: string; source: string; status: "live" | "draft" | "retired"; created_at: string };
type Module = { n: number; name: string; page: string; auto: "full" | "partial" | "manual"; does: string; person: string };
type Lesson = {
  id: string; title: string; minutes: number; short: string; points: { h: string; t: string }[];
  example: string; tryThis: string; terms: [string, string][]; checks: number;
};
type Level = { key: string; label: string; tag: string; what: string; outcomes: string[]; lessons: Lesson[] };
type Progress = { lessons: Record<string, { passed: boolean; best: number; total: number }>; levels: Record<string, { passed: boolean; best: number; tries: number }> };
type Data = {
  kinds: { kind: Kind; label: string; what: string }[];
  size: number; pass: number; counts: Record<Kind, number>; modules: Module[];
  mine: { id: string; kind: string; score: number; total: number; finished_at: string }[];
  levels: Level[]; lesson_pass: number; progress: Progress;
  can_manage: boolean;
  team: { user_id: string; name: string; tests: number; last: number; average: number; last_at: string; weakest: string[] }[] | null;
  team_course: { user_id: string; name: string; lessons: number; levels: string[] }[] | null;
  bank: Question[] | null;
};
type Result = { score: number; total: number; percent: number; passed: boolean; marked: Marked[] };

const pct = (s: number, t: number) => (t ? Math.round((s / t) * 100) : 0);
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const AUTO = { full: "Runs by itself", partial: "Circuit does it when asked", manual: "Kept by a person" } as const;

/* Questions, answered one click each, then marked with the reason. Shared by the lesson check
   and the bigger tests. */
function Quiz({ questions, answers, setAnswers, result, label }: {
  questions: Asked[]; answers: number[]; setAnswers: (f: (a: number[]) => number[]) => void; result: Result | null; label: (q: Asked) => string;
}) {
  if (result) {
    return (
      <ol className="quiz">
        {result.marked.map((m) => (
          <li key={m.id} className={m.right ? "right" : "wrong"}>
            <p className="eyebrow">{label(m)}</p>
            <strong>{m.question}</strong>
            <ul>
              {m.options.map((o, i) => (
                <li key={i} className={i === m.answer ? "key" : i === m.chose ? "picked" : ""}>{o}{i === m.answer ? " — the answer" : i === m.chose ? " — your answer" : ""}</li>
              ))}
            </ul>
            <p className="small muted">{m.why}</p>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="quiz">
      {questions.map((q, n) => (
        <li key={q.id}>
          <p className="eyebrow">{label(q)}</p>
          <strong>{q.question}</strong>
          <ul>
            {q.options.map((o, i) => (
              <li key={i}>
                <label className={answers[n] === i ? "on" : ""}>
                  <input type="radio" name={q.id} checked={answers[n] === i} onChange={() => setAnswers((a) => a.map((v, j) => (j === n ? i : v)))} />
                  {o}
                </label>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export default function LearningPage() {
  const [d, setD] = useState<Data | null>(null);
  /* A test in the main column: a level test or a practice test. */
  const [test, setTest] = useState<{ kind: string; attempt: string; questions: Asked[] } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<(Result & { kind: string }) | null>(null);
  /* The lesson open in the reader, and its check. */
  const [reading, setReading] = useState<string | null>(null);
  const [check, setCheck] = useState<{ attempt: string; questions: Asked[] } | null>(null);
  const [checkAns, setCheckAns] = useState<number[]>([]);
  const [checkResult, setCheckResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState("");
  const [gen, setGen] = useState<{ kind: Kind; topic: string; count: number }>({ kind: "platforms", topic: "", count: 5 });
  const [bankView, setBankView] = useState<"draft" | "live" | "retired">("draft");
  const { push: toast, view } = useToast();

  const load = useCallback(() => api<Data>("/api/learning").then(setD).catch((e) => toast((e as Error).message)), [toast]);
  useEffect(() => { load(); }, [load]);

  const openLesson = useCallback((id: string | null) => {
    setReading(id); setCheck(null); setCheckResult(null); setCheckAns([]);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("lesson", id); else u.searchParams.delete("lesson");
    window.history.replaceState(null, "", u.toString());
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lesson");
    if (id) setReading(id);
  }, []);
  useEffect(() => {
    if (!reading) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") openLesson(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [reading, openLesson]);

  async function start(kind: string) {
    setBusy(kind); setResult(null);
    try {
      const t = await postJson<{ attempt: string; questions: Asked[] }>("/api/learning", { action: "start", kind });
      setTest({ kind, ...t }); setAnswers(t.questions.map(() => -1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { toast((e as Error).message); }
    setBusy("");
  }

  async function handIn() {
    if (!test) return;
    setBusy("submit");
    try {
      const r = await postJson<Result>("/api/learning", { action: "submit", attempt: test.attempt, answers });
      setResult({ ...r, kind: test.kind }); setTest(null); load();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { toast((e as Error).message); }
    setBusy("");
  }

  async function startCheck(id: string) {
    setBusy("check"); setCheckResult(null);
    try {
      const t = await postJson<{ attempt: string; questions: Asked[] }>("/api/learning", { action: "start", kind: `lesson:${id}` });
      setCheck(t); setCheckAns(t.questions.map(() => -1));
    } catch (e) { toast((e as Error).message); }
    setBusy("");
  }

  async function handInCheck() {
    if (!check) return;
    setBusy("check");
    try {
      const r = await postJson<Result>("/api/learning", { action: "submit", attempt: check.attempt, answers: checkAns });
      setCheckResult(r); setCheck(null); load();
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

  const lessons = d.levels.flatMap((l, li) => l.lessons.map((x, i) => ({ ...x, level: l, li, i })));
  const isDone = (id: string) => Boolean(d.progress.lessons[id]?.passed);
  const doneCount = lessons.filter((l) => isDone(l.id)).length;
  const levelsPassed = d.levels.filter((l) => d.progress.levels[l.key]?.passed).length;
  const next = lessons.find((l) => !isDone(l.id));
  /* The level to suggest a test for: the first whose lessons are all done but whose test is not passed. */
  const testDue = d.levels.find((l) => l.lessons.every((x) => isDone(x.id)) && !d.progress.levels[l.key]?.passed);
  const kindLabel = (k: string) => {
    if (k.startsWith("lesson:")) { const l = lessons.find((x) => x.id === k.slice(7)); return l ? `Lesson · ${l.title}` : "Lesson"; }
    if (k.startsWith("level:")) { const l = d.levels.find((x) => x.key === k.slice(6)); return l ? `${l.label} — level test` : "Level test"; }
    return d.kinds.find((x) => x.kind === k)?.label || "Mixed";
  };
  const qLabel = (q: Asked) => `${q.topic}`;
  const answered = answers.filter((a) => a >= 0).length;
  const open = reading ? lessons.find((l) => l.id === reading) : null;
  const done = d.mine.length;
  const last = d.mine[0];

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h1>Learning</h1>
          <p className="lede">
            A marketing course for somebody starting out — four levels, six short lessons each. Read a lesson in three to
            five minutes, answer three questions, move on. Each level ends with a {d.size}-question test; {d.pass}% passes.
          </p>
        </div>
      </div>

      {/* ---- where you are ---- */}
      <section className="lr-hero">
        <div className="lr-next">
          {testDue && (!next || next.li > d.levels.indexOf(testDue)) ? (
            <>
              <span className="eyebrow">Up next · {testDue.label}</span>
              <h3>{testDue.label} level test</h3>
              <p>You have finished every {testDue.label.toLowerCase()} lesson. {d.size} questions from all six — {d.pass}% passes the level.</p>
              <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={() => start(`level:${testDue.key}`)}>{busy === `level:${testDue.key}` ? "Starting…" : "Take the level test"}</button>
            </>
          ) : next ? (
            <>
              <span className="eyebrow">{doneCount ? "Continue" : "Start here"} · {next.level.label} · lesson {next.i + 1} of {next.level.lessons.length} · {next.minutes} min</span>
              <h3>{next.title}</h3>
              <p>{next.short}</p>
              <button className="btn primary" type="button" onClick={() => openLesson(next.id)}>{doneCount ? "Continue" : "Start the first lesson"}</button>
            </>
          ) : (
            <>
              <span className="eyebrow">Course complete</span>
              <h3>Every lesson done</h3>
              <p>Keep sharp with the practice tests below — new platform-update questions arrive as the platforms change.</p>
            </>
          )}
        </div>
        <div className="lr-overall">
          {/* The share of the course done, as a thin ring drawn in SVG. */}
          <div className="lr-ring">
            <svg viewBox="0 0 112 112" aria-hidden="true">
              <circle cx="56" cy="56" r="50" className="lr-ring-track" />
              <circle cx="56" cy="56" r="50" className="lr-ring-done" pathLength={100} strokeDasharray={`${pct(doneCount, lessons.length)} 100`} transform="rotate(-90 56 56)" />
            </svg>
            <b>{pct(doneCount, lessons.length)}%</b><span>of the course</span>
          </div>
          <div className="lr-overall-text">
            <strong>{doneCount} of {lessons.length} lessons</strong>
            <span>{levelsPassed} of {d.levels.length} levels passed</span>
            <span className="muted small">{done ? `${done} test${done === 1 ? "" : "s"} handed in · last ${pct(last.score, last.total)}%` : "Nothing handed in yet"}</span>
          </div>
        </div>
      </section>

      {/* ---- a level test or practice test, and its result ---- */}
      {result ? (
        <section className="panel stack">
          <div className="panel-head">
            <h3>{kindLabel(result.kind)} — {result.score} of {result.total}, {result.percent}%</h3>
            <Pill tone={result.passed ? "ok" : "warn"}>{result.passed ? "Passed" : `Below ${d.pass}% — go over the lessons and try again`}</Pill>
          </div>
          <Quiz questions={[]} answers={[]} setAnswers={() => undefined} result={result} label={qLabel} />
          <span className="actions"><button className="btn" type="button" onClick={() => setResult(null)}>Done</button></span>
        </section>
      ) : null}
      {test ? (
        <section className="panel stack">
          <div className="panel-head"><h3>{kindLabel(test.kind)}</h3><span className="muted small">{answered} of {test.questions.length} answered</span></div>
          <Quiz questions={test.questions} answers={answers} setAnswers={setAnswers} result={null} label={qLabel} />
          <span className="actions">
            <button className="btn ghost" type="button" onClick={() => setTest(null)}>Leave it</button>
            <button className="btn primary" type="button" disabled={answered < test.questions.length || busy === "submit"} onClick={handIn}>{busy === "submit" ? "Marking…" : "Hand it in"}</button>
          </span>
        </section>
      ) : null}

      {/* ---- the syllabus ---- */}
      <section className="stack" style={{ gap: 12 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>The syllabus</h3><span className="muted small">Go in order, or jump to what you need</span></div>
        <div className="lr-levels">
          {d.levels.map((lv, li) => {
            const n = lv.lessons.filter((x) => isDone(x.id)).length;
            const lp = d.progress.levels[lv.key];
            return (
              <article key={lv.key} className={`lr-level ${lp?.passed ? "is-passed" : ""}`}>
                <header>
                  <span className="lr-step">{li + 1}</span>
                  <div>
                    <span className="eyebrow">{lv.tag}</span>
                    <h4>{lv.label}</h4>
                  </div>
                  {lp?.passed ? <Pill tone="ok">Passed</Pill> : null}
                </header>
                <p className="small muted">{lv.what}</p>
                <div className="lr-bar" aria-label={`${n} of ${lv.lessons.length} lessons done`}><i style={{ width: `${pct(n, lv.lessons.length)}%` }} /></div>
                <ol className="lr-lessons">
                  {lv.lessons.map((x, i) => (
                    <li key={x.id}>
                      <button type="button" className={`${isDone(x.id) ? "is-done" : ""} ${next?.id === x.id ? "is-next" : ""}`} onClick={() => openLesson(x.id)}>
                        <span className="lr-tick" aria-hidden="true">{isDone(x.id) ? <svg className="ck" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg> : i + 1}</span>
                        <span className="lr-title">{x.title}</span>
                        <span className="lr-min">{x.minutes} min</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <details className="lr-outcomes">
                  <summary className="small">After this level you can…</summary>
                  <ul className="small">{lv.outcomes.map((o) => <li key={o}>{o}</li>)}</ul>
                </details>
                <button type="button" className={`btn small ${n === lv.lessons.length && !lp?.passed ? "primary" : ""}`} disabled={Boolean(busy) || Boolean(test)} onClick={() => start(`level:${lv.key}`)}>
                  {busy === `level:${lv.key}` ? "Starting…" : lp ? `Level test · best ${lp.best}%` : `Level test · ${d.size} questions`}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {/* ---- practice tests ---- */}
      {!test ? (
        <section className="panel stack">
          <div className="panel-head"><h3>Practice tests</h3><span className="muted small">{d.size} questions each · ones you have not seen come first</span></div>
          <div className="lr-practice">
            {d.kinds.map((k) => (
              <div key={k.kind} className="lr-prac">
                <strong>{k.label}</strong>
                <span className="small muted">{k.what}</span>
                <span className="small">{d.counts[k.kind]} questions</span>
                <button className="btn small" type="button" disabled={!d.counts[k.kind] || Boolean(busy)} onClick={() => start(k.kind)}>
                  {busy === k.kind ? "Starting…" : d.counts[k.kind] ? "Start" : "No questions yet"}
                </button>
              </div>
            ))}
            <div className="lr-prac">
              <strong>A bit of everything</strong>
              <span className="small muted">Mixed from the whole bank, course included</span>
              <span className="small">{d.size} questions</span>
              <button className="btn small primary" type="button" disabled={Boolean(busy)} onClick={() => start("mixed")}>{busy === "mixed" ? "Starting…" : "Start"}</button>
            </div>
          </div>
          <details>
            <summary className="small"><strong>Read first: what Circuit does, line by line</strong> <span className="muted">— the "Our platform" questions come from this</span></summary>
            <div className="list" style={{ marginTop: 14 }}>
              {d.modules.map((m) => (
                <div key={m.n} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div><strong>{m.n}. {m.name}</strong><p>{m.does} <span className="muted">A person: {m.person}</span></p></div>
                  <Pill tone={m.auto === "full" ? "ok" : m.auto === "partial" ? "info" : "warn"}>{AUTO[m.auto]}</Pill>
                </div>
              ))}
            </div>
          </details>
        </section>
      ) : null}

      {done ? (
        <details className="panel">
          <summary><strong>Your tests</strong> <span className="muted small">— {done} handed in</span></summary>
          <div className="list" style={{ marginTop: 12 }}>
            {d.mine.map((a) => (
              <div key={a.id} className="list-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><strong>{kindLabel(a.kind)}</strong><p>{day(a.finished_at)}</p></div>
                <Pill tone={(a.kind.startsWith("lesson:") ? a.score >= Math.min(d.lesson_pass, a.total) : pct(a.score, a.total) >= d.pass) ? "ok" : "warn"}>{a.score}/{a.total} · {pct(a.score, a.total)}%</Pill>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* ---- the Manager's and the Admin's view ---- */}
      {d.can_manage && d.team ? (
        <section className="panel stack">
          <div className="panel-head"><h3>The team</h3><span className="muted small">Course progress, and the topics where most answers went wrong</span></div>
          {d.team.length ? (
            <div className="list">
              {d.team.map((p) => {
                const c = d.team_course?.find((x) => x.user_id === p.user_id);
                return (
                  <div key={p.user_id} className="list-item" style={{ gridTemplateColumns: "1fr auto auto" }}>
                    <div>
                      <strong>{p.name}</strong>
                      <p>{c ? `${c.lessons} of ${lessons.length} lessons${c.levels.length ? ` · passed ${c.levels.join(", ")}` : ""} · ` : ""}{p.tests} test{p.tests === 1 ? "" : "s"} · last {day(p.last_at)}{p.weakest.length ? ` · weakest: ${p.weakest.join(", ")}` : ""}</p>
                    </div>
                    <span className="small muted">avg {p.average}%</span>
                    <Pill tone={p.last >= d.pass ? "ok" : "warn"}>last {p.last}%</Pill>
                  </div>
                );
              })}
            </div>
          ) : <Empty title="Nobody has started yet" hint="Progress shows here as people hand in lesson checks and tests." />}
        </section>
      ) : null}

      {d.can_manage && d.bank ? (
        <details className="panel">
          <summary><strong>Question bank</strong> <span className="muted small">— ChatGPT&rsquo;s questions wait here until you pass them · {d.bank.filter((q) => q.status === "draft").length} waiting</span></summary>
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="actions" style={{ flexWrap: "wrap", gap: 8 }}>
              <select className="input" aria-label="Kind of question" value={gen.kind} style={{ width: "auto", minHeight: 38 }} onChange={(e) => setGen({ ...gen, kind: e.target.value as Kind })}>
                {d.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <input className="input" placeholder="Focus (optional) — e.g. Instagram Reels, B2B funnels" value={gen.topic} style={{ flex: 1, minWidth: 220 }} onChange={(e) => setGen({ ...gen, topic: e.target.value })} />
              <select className="input" aria-label="How many" value={gen.count} style={{ width: "auto", minHeight: 38 }} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })}>
                {[3, 5, 10].map((n) => <option key={n} value={n}>{n} questions</option>)}
              </select>
              <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={generate}>{busy === "generate" ? "Writing — a few minutes…" : "Write new questions"}</button>
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
                    <p className="eyebrow">{kindLabel(q.kind)} · {q.topic} · {q.source}</p>
                    <strong>{q.question}</strong>
                    <ul>{q.options.map((o, i) => <li key={i} className={i === q.answer ? "key" : ""}>{o}{i === q.answer ? " — the answer" : ""}</li>)}</ul>
                    <p className="small muted">{q.why}</p>
                    <span className="actions">
                      {q.status !== "live" ? <button className="btn small primary" type="button" onClick={() => mark(q.id, "live")}>{q.status === "draft" ? "Pass it" : "Use again"}</button> : null}
                      {q.status !== "retired" ? <button className="btn small ghost" type="button" onClick={() => mark(q.id, "retired")}>{q.status === "draft" ? "Throw out" : "Retire"}</button> : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : <Empty title={bankView === "draft" ? "Nothing waiting" : "None here"} hint={bankView === "draft" ? "Write new questions above — they land here first." : undefined} />}
          </div>
        </details>
      ) : null}

      {/* ---- the lesson reader ---- */}
      {open ? (
        <>
          <div className="wk-scrim" onClick={() => openLesson(null)} />
          <aside className="lr-sheet" role="dialog" aria-label={open.title}>
            <div className="lr-sheet-head">
              <span className="eyebrow">{open.level.label} · lesson {open.i + 1} of {open.level.lessons.length} · {open.minutes} min read</span>
              <button type="button" className="tb-btn" aria-label="Close" onClick={() => openLesson(null)}>×</button>
            </div>
            <h2 className="lr-h">{open.title}</h2>
            <p className="lr-short">{open.short}</p>

            <ol className="lr-points">
              {open.points.map((p) => <li key={p.h}><strong>{p.h}</strong><span>{p.t}</span></li>)}
            </ol>

            <div className="lr-callout">
              <span className="eyebrow">At BNC</span>
              <p>{open.example}</p>
            </div>

            <div className="lr-terms">
              <span className="eyebrow">Words to know</span>
              <dl>{open.terms.map(([t, m]) => <div key={t}><dt>{t}</dt><dd>{m}</dd></div>)}</dl>
            </div>

            <div className="lr-try">
              <span className="eyebrow">Try this</span>
              <p>{open.tryThis}</p>
            </div>

            <section className="lr-check">
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <h3>Check yourself</h3>
                <span className="small muted">{isDone(open.id) ? "Done. Take it again any time." : `${d.lesson_pass} of ${open.checks} right marks the lesson done`}</span>
              </div>
              {checkResult ? (
                <>
                  <div className={`note small ${checkResult.passed ? "ok" : ""}`}>
                    {checkResult.score} of {checkResult.total} right. {checkResult.passed ? "Lesson done." : "Read it once more and try again."}
                  </div>
                  <Quiz questions={[]} answers={[]} setAnswers={() => undefined} result={checkResult} label={qLabel} />
                </>
              ) : check ? (
                <>
                  <Quiz questions={check.questions} answers={checkAns} setAnswers={setCheckAns} result={null} label={qLabel} />
                  <button className="btn primary" type="button" disabled={checkAns.some((a) => a < 0) || busy === "check"} onClick={handInCheck}>{busy === "check" ? "Marking…" : "Check my answers"}</button>
                </>
              ) : (
                <button className="btn primary" type="button" disabled={busy === "check"} onClick={() => startCheck(open.id)}>{busy === "check" ? "Starting…" : `Answer ${open.checks} questions`}</button>
              )}
            </section>

            <div className="lr-nav">
              {(() => {
                const at = lessons.findIndex((l) => l.id === open.id);
                const prev = lessons[at - 1];
                const nxt = lessons[at + 1];
                return (
                  <>
                    {prev ? <button type="button" className="btn ghost" onClick={() => openLesson(prev.id)}>← {prev.title}</button> : <span />}
                    {nxt ? <button type="button" className={`btn ${checkResult?.passed ? "primary" : ""}`} onClick={() => openLesson(nxt.id)}>{nxt.title} →</button> : null}
                  </>
                );
              })()}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
