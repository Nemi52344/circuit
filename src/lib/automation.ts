import { getDb, getSetting } from "@/lib/db";
import { chatgptStatus, codexPath } from "@/lib/chatgpt";
import { getMetaToken } from "@/lib/meta";

/* What Circuit is plugged into, and what runs by itself.

   Both answers existed already and neither could be read anywhere: connection state was
   scattered across Settings and the health panel, and the agents had no memory of whether
   they had ever run. This gathers them. */

/* ---------- the connections ---------- */

export type Connection = {
  key: string;
  name: string;
  what: string;
  state: "live" | "set" | "missing" | "blocked";
  detail: string;
  /* Why it is not connected, when that is a decision rather than a missing key. */
  blocker?: string;
  where?: string;
};

const has = (k: string) => Boolean((getSetting(k) || "").trim());

export async function connections(): Promise<Connection[]> {
  const out: Connection[] = [];

  const gpt = await chatgptStatus().catch(() => null);
  out.push({
    key: "chatgpt", name: "ChatGPT", what: "Research, captions, topic ideas, drafted images",
    state: gpt?.logged_in ? "live" : codexPath() ? "set" : "missing",
    detail: gpt?.logged_in ? `Signed in${gpt.version ? ` · ${gpt.version}` : ""}`
      : codexPath() ? "Installed but signed out" : "Codex not installed",
    where: "/settings",
  });

  const token = getMetaToken();
  const until = getSetting("meta_token_until") || "";
  const days = until ? Math.round((new Date(until).getTime() - Date.now()) / 86400000) : null;
  out.push({
    key: "meta", name: "Meta — Instagram & Facebook", what: "Reads competitors, publishes posts and reels",
    state: token ? "live" : "missing",
    detail: token
      ? `@${getSetting("ig_username") || getSetting("ig_user_id") || "connected"}${days !== null ? ` · ${days} days left on the token` : ""}`
      : "No token saved",
    where: "/settings",
  });

  out.push({
    key: "gemini", name: "Google AI (Gemini)", what: "Generates images from a reference and a product photo",
    state: has("gemini_key") ? "set" : "missing",
    detail: has("gemini_key")
      /* Worth saying plainly: the key is accepted and the quota is zero, which looks like a
         broken key until somebody reads the error. */
      ? "Key saved. The free tier allows no image generation — billing must be enabled for it to produce anything"
      : "No key saved",
    where: "/settings",
  });

  out.push({
    key: "higgsfield", name: "Higgsfield", what: "Image generation through a Claude session",
    state: has("hf_key_id") && has("hf_key_secret") ? "set" : "missing",
    detail: has("hf_key_id") ? "Key saved · drained by hand from a Claude session" : "No key saved",
    where: "/settings",
  });

  out.push({
    key: "postiz", name: "Postiz", what: "Would publish to LinkedIn and X on Circuit's behalf",
    state: has("postiz_key") ? "set" : "missing",
    detail: has("postiz_key") ? "Key saved" : "No key saved — LinkedIn and X are handed over by hand instead",
    where: "/settings",
  });

  out.push({
    key: "supabase", name: "Supabase", what: "Off-machine copy of published media",
    state: has("sb_key") ? "set" : "missing",
    detail: has("sb_key") ? "Key saved" : "No key saved",
    where: "/settings",
  });

  /* Named here even though nothing is half-done, because the Tagged links panel sends people
     looking for it. A gap you can see is a decision; a gap you cannot is a bug report. */
  out.push({
    key: "site_analytics", name: "Website analytics", what: "Click counts for tagged links",
    state: has("analytics_key") ? "set" : "missing",
    detail: has("analytics_key")
      ? "Key saved"
      : "Nothing connected — Circuit tags the links, but the clicks have to be read off the website's own analytics and typed in",
    where: "/settings",
  });

  /* The ones that cannot be connected by pasting a key. Named here rather than left off, so
     the list answers "why is LinkedIn not here" instead of pretending the question never
     comes up. */
  out.push({
    key: "linkedin", name: "LinkedIn company pages", what: "Publishing to a company page",
    state: "blocked", detail: "Not connectable today",
    blocker: "LinkedIn grants this only under a partner agreement. Posts are handed over by hand.",
  });
  out.push({
    key: "whatsapp", name: "WhatsApp Business", what: "Template messages to opted-in numbers",
    state: "blocked", detail: "Not connectable today",
    blocker: "Needs Meta template approval and recorded opt-in per number.",
  });
  out.push({
    key: "wordpress", name: "WordPress", what: "Pushing an approved blog as a draft",
    state: "blocked", detail: "Not connectable today",
    blocker: "Needs a WordPress site and an application password.",
  });

  return out;
}

/* ---------- the bots ---------- */

export type Bot = {
  id: string; name: string; purpose: string;
  searches: boolean; active: boolean; builtin: boolean;
  runs: number; fails: number;
  last_run: string; last_ok: number | null; last_error: string; last_seconds: number;
  /* What the app would say about it in one word. "not recorded" is deliberately not the
     same as "never run": run tracking only started on 21 Oct 2026, so a bot with no mark on
     it has simply not run since then. Calling that "never" would be a lie about history. */
  state: "working" | "failing" | "not recorded" | "off";
};

export function bots(): Bot[] {
  const rows = getDb()
    .prepare(`SELECT id, name, purpose, search, active, builtin,
                     COALESCE(runs,0) runs, COALESCE(fails,0) fails,
                     COALESCE(last_run,'') last_run, last_ok,
                     COALESCE(last_error,'') last_error, COALESCE(last_seconds,0) last_seconds
              FROM agents ORDER BY builtin DESC, name`)
    .all() as (Omit<Bot, "searches" | "active" | "builtin" | "state"> & { search: number; active: number; builtin: number })[];

  return rows.map((r) => ({
    id: r.id, name: r.name, purpose: r.purpose,
    searches: r.search === 1, active: r.active === 1, builtin: r.builtin === 1,
    runs: r.runs, fails: r.fails,
    last_run: r.last_run, last_ok: r.last_ok, last_error: r.last_error, last_seconds: r.last_seconds,
    state: r.active !== 1 ? "off" : !r.last_run ? "not recorded" : r.last_ok === 1 ? "working" : "failing",
  }));
}

/* The workflows that run on a schedule, which are the other half of "what runs by itself". */
export type Routine = {
  id: string; name: string; trigger: string; at_time: string; active: boolean;
  runs: number; failed: number; waiting: number; last: string;
};

export function routines(): Routine[] {
  return getDb().prepare(`
    SELECT w.id, w.name, w.trigger, w.at_time, w.active,
           (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id) runs,
           (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id AND r.status = 'failed') failed,
           (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id AND r.status = 'waiting') waiting,
           COALESCE((SELECT MAX(r.started_at) FROM workflow_runs r WHERE r.workflow_id = w.id), '') last
    FROM workflows w ORDER BY w.trigger != 'manual' DESC, w.name`)
    .all().map((r) => ({ ...(r as Routine), active: (r as unknown as { active: number }).active === 1 }));
}

/* ---------- where the time goes ---------- */

/* Two kinds of minute, and the whole point is telling them apart.

   Machine minutes are what Circuit spent doing something nobody had to watch: an agent
   researching, an action syncing. Person minutes are what it still asked of somebody — a
   workflow stopped at a "you" step, a task on the board.

   The ratio of the two is the automation figure. It is reported with the evidence behind it
   rather than as a bare percentage, because a number like "68% automated" with nothing under
   it is the kind of thing that ends up in a slide and then in a decision. */
export type TimeArea = {
  area: string;
  machine_minutes: number;
  person_minutes: number;
  /* How much of the measured time in this area ran without a person. Null when nothing has
     been measured yet, rather than 0 — those mean very different things. */
  automated: number | null;
  runs: number;
  tasks: number;
  /* Work somebody has marked as something the app could take over. This is the backlog the
     notebook asks for: where the ideas for improvement should go. */
  could_automate_minutes: number;
};

export type TimePicture = {
  machine_minutes: number;
  person_minutes: number;
  automated: number | null;
  measured_from: string;
  areas: TimeArea[];
  /* The slowest things, by where the time actually went. */
  heaviest: { what: string; kind: "machine" | "person"; minutes: number; detail: string }[];
  /* Honest about its own gaps, because a figure built on three runs is not a figure. */
  gaps: string[];
};

type RunRow = { id: string; name: string; status: string; started_at: string; steps: string };
type Step = { title?: string; kind?: string; status?: string; seconds?: number; waited_minutes?: number };

export function timePicture(days = 30): TimePicture {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const runs = db.prepare(`
    SELECT r.id, COALESCE(w.name,'(deleted routine)') name, r.status, r.started_at, r.steps
    FROM workflow_runs r LEFT JOIN workflows w ON w.id = r.workflow_id
    WHERE r.started_at >= ?`).all(since) as RunRow[];

  const byArea = new Map<string, TimeArea>();
  const area = (k: string): TimeArea => {
    if (!byArea.has(k)) byArea.set(k, { area: k, machine_minutes: 0, person_minutes: 0, automated: null, runs: 0, tasks: 0, could_automate_minutes: 0 });
    return byArea.get(k)!;
  };

  const heaviest: TimePicture["heaviest"] = [];
  let machine = 0;
  let person = 0;

  for (const r of runs) {
    let steps: Step[] = [];
    try { steps = JSON.parse(r.steps || "[]"); } catch { steps = []; }
    const a = area("routines");
    a.runs += 1;
    for (const s of steps) {
      const mins = (s.seconds || 0) / 60;
      if (mins > 0) { machine += mins; a.machine_minutes += mins; }
      if (s.waited_minutes) { person += s.waited_minutes; a.person_minutes += s.waited_minutes; }
      if (mins >= 1) heaviest.push({ what: `${r.name} — ${s.title || s.kind || "step"}`, kind: "machine", minutes: Math.round(mins), detail: "ran without anyone watching" });
      if ((s.waited_minutes || 0) >= 1) heaviest.push({ what: `${r.name} — ${s.title || "waiting on you"}`, kind: "person", minutes: s.waited_minutes!, detail: "the run stopped until somebody acted" });
    }
  }

  /* Only work that has actually started counts towards the time.

     An estimate on a task nobody has begun is a plan, not an hour anybody has spent, and
     counting it would let somebody move this figure by writing down more intentions. It matters
     more now the board can be filled from a standard plan: thirty untouched template rows would
     otherwise read as two hundred hours already worked by hand. */
  const tasks = db.prepare(`
    SELECT area, COALESCE(estimate_minutes,0) est, COALESCE(spent_minutes,0) spent,
           COALESCE(doable_by,'') doable, title, status
    FROM tasks
    WHERE COALESCE(spent_minutes,0) > 0
       OR (COALESCE(estimate_minutes,0) > 0 AND status IN ('doing','done'))`)
    .all() as { area: string; est: number; spent: number; doable: string; title: string; status: string }[];

  for (const t of tasks) {
    const a = area(t.area || "other");
    const mins = t.spent || t.est;
    a.tasks += 1;
    a.person_minutes += mins;
    person += mins;
    if (t.doable === "app") a.could_automate_minutes += mins;
    if (mins >= 30) heaviest.push({ what: t.title, kind: "person", minutes: mins, detail: t.doable === "app" ? "marked as something Circuit could take over" : "done by hand" });
  }

  for (const a of byArea.values()) {
    a.machine_minutes = Math.round(a.machine_minutes);
    const total = a.machine_minutes + a.person_minutes;
    a.automated = total > 0 ? Math.round((a.machine_minutes / total) * 100) : null;
  }

  const notStarted = db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(estimate_minutes),0) mins FROM tasks
    WHERE COALESCE(spent_minutes,0) = 0 AND COALESCE(estimate_minutes,0) > 0
      AND status NOT IN ('doing','done')`).get() as { n: number; mins: number };

  const total = machine + person;
  const gaps: string[] = [];
  if (notStarted.n) gaps.push(`${notStarted.n} task${notStarted.n === 1 ? "" : "s"} carrying ${Math.round(notStarted.mins / 60)} hours of estimate have not been started, so none of that is counted here. An estimate is a plan, not an hour spent.`);
  if (!tasks.length) gaps.push("No task on the board has a time against it, so every person-minute here comes from workflows waiting. The figure is about routines, not about the work.");
  if (runs.length < 10) gaps.push(`Only ${runs.length} routine run${runs.length === 1 ? "" : "s"} in the last ${days} days — too few to draw a line through.`);
  if (person === 0 && machine > 0) gaps.push("Nothing has been recorded as person-time yet, so this reads as fully automated. It is not; it is unmeasured.");

  return {
    machine_minutes: Math.round(machine),
    person_minutes: Math.round(person),
    automated: total > 0 ? Math.round((machine / total) * 100) : null,
    measured_from: since.slice(0, 10),
    areas: [...byArea.values()].sort((x, y) => (y.machine_minutes + y.person_minutes) - (x.machine_minutes + x.person_minutes)),
    heaviest: heaviest.sort((x, y) => y.minutes - x.minutes).slice(0, 12),
    gaps,
  };
}

/* ---- what each person's time is going on ---- */

/* The same minutes as timePicture, cut by who is doing the work instead of by what area it is
   in. Two different questions: one asks which routines are slow, this one asks whether anybody
   is spending their week on something Circuit could be doing instead.

   It reads the board only. A routine that stopped and waited knows how long it waited and not
   who it waited for, so attributing that time to a person would be a guess dressed as a number. */
export type PersonTime = {
  owner: string;
  tasks: number;
  minutes: number;
  /* Of those minutes, the ones on work somebody has marked as doable by the app. */
  automatable_minutes: number;
  /* The share of this person's measured time that could come off their plate. Null when none
     of their work has been marked either way — unmarked is not the same as "a person must". */
  could_come_off: number | null;
  unmarked_minutes: number;
  /* Estimates against reality, for the tasks that carry both. */
  estimated: number;
  actual: number;
  heaviest: string;
};

export type PeoplePicture = {
  people: PersonTime[];
  total_minutes: number;
  automatable_minutes: number;
  unmarked_minutes: number;
  gaps: string[];
};

export function peopleTime(): PeoplePicture {
  /* Started work only, for the same reason as timePicture: an untouched estimate is a plan. */
  const rows = getDb().prepare(`
    SELECT COALESCE(NULLIF(TRIM(owner), ''), '(nobody)') owner, title,
           COALESCE(estimate_minutes, 0) est, COALESCE(spent_minutes, 0) spent,
           COALESCE(doable_by, '') doable
    FROM tasks
    WHERE COALESCE(spent_minutes, 0) > 0
       OR (COALESCE(estimate_minutes, 0) > 0 AND status IN ('doing','done'))`)
    .all() as { owner: string; title: string; est: number; spent: number; doable: string }[];

  const by = new Map<string, PersonTime & { _top: number }>();
  for (const r of rows) {
    const p = by.get(r.owner) || {
      owner: r.owner, tasks: 0, minutes: 0, automatable_minutes: 0, could_come_off: null,
      unmarked_minutes: 0, estimated: 0, actual: 0, heaviest: "", _top: 0,
    };
    /* What it really took, when that is known; otherwise what it was expected to take. */
    const mins = r.spent || r.est;
    p.tasks += 1;
    p.minutes += mins;
    p.estimated += r.est;
    p.actual += r.spent;
    if (r.doable === "app") p.automatable_minutes += mins;
    if (!r.doable) p.unmarked_minutes += mins;
    if (mins > p._top) { p._top = mins; p.heaviest = r.title; }
    by.set(r.owner, p);
  }

  const people = [...by.values()].map(({ _top, ...p }) => ({
    ...p,
    /* Measured against the work that has actually been judged, not against everything: a person
       whose work is mostly unmarked would otherwise look efficient for never having been asked. */
    could_come_off: p.minutes - p.unmarked_minutes > 0
      ? Math.round((p.automatable_minutes / (p.minutes - p.unmarked_minutes)) * 100)
      : null,
  })).sort((a, b) => b.minutes - a.minutes);

  const total = people.reduce((a, p) => a + p.minutes, 0);
  const auto = people.reduce((a, p) => a + p.automatable_minutes, 0);
  const unmarked = people.reduce((a, p) => a + p.unmarked_minutes, 0);

  const gaps: string[] = [];
  if (!rows.length) gaps.push("No task on the board carries a time yet, so there is nothing to divide between people.");
  if (unmarked) gaps.push(`${Math.round(unmarked)} minutes are on work nobody has said is a person's job or Circuit's. Those minutes are counted in the totals and left out of every percentage.`);
  if (people.some((p) => p.owner === "(nobody)")) gaps.push("Some timed work has no owner, so it is grouped under “(nobody)” rather than shared out.");
  if (people.some((p) => p.actual === 0)) gaps.push("Some of this is estimates rather than what the work really took — an estimate nobody corrected afterwards tends to flatter.");

  return { people, total_minutes: Math.round(total), automatable_minutes: Math.round(auto), unmarked_minutes: Math.round(unmarked), gaps };
}
