import { getDb, newId, now } from "@/lib/db";
import { runChatGptJson } from "@/lib/chatgpt";
import { MODULES } from "@/lib/modules";
import { ROLES } from "@/lib/roles";
import { LEVELS, ALL_LESSONS, LESSON_PASS, questionId, lessonById, levelByKey } from "@/lib/syllabus";

/* Tests for the marketing team.

   Three kinds of question. "circuit" — how our own platform works, so an executive knows what
   it will do for them and what it will not. "platforms" — what Instagram, LinkedIn, X and Meta
   have changed lately. "marketing" — the general craft.

   The answer key never leaves the server until the test is handed in: a test is started, the
   questions it holds are fixed in the attempt, and grading reads the key from the bank. A
   question ChatGPT writes is a draft until a Marketing Manager or the Admin passes it, because
   a test that teaches a wrong answer is worse than no test. */

export type Kind = "circuit" | "platforms" | "marketing";
export const KINDS: { kind: Kind; label: string; what: string }[] = [
  { kind: "circuit", label: "Our platform", what: "What Circuit does, who can do what, and why some steps stay with a person" },
  { kind: "platforms", label: "Platform updates", what: "Recent changes on Instagram, LinkedIn, X and Meta" },
  { kind: "marketing", label: "Marketing", what: "The general craft — metrics, funnels, testing, tracking" },
];
const isKind = (v: unknown): v is Kind => KINDS.some((k) => k.kind === v);

export const TEST_SIZE = 10;
export const PASS_MARK = 70;

export type Question = {
  id: string; kind: Kind; topic: string; question: string; options: string[]; answer: number; why: string;
  source: string; status: "live" | "draft" | "retired"; created_at: string;
};
type Row = Omit<Question, "options"> & { options: string };
const fromRow = (r: Row): Question => ({ ...r, options: JSON.parse(r.options) as string[] });

/* The seed bank. Stable ids, so adding one here adds it to every database on its next read and
   editing one here does not create a second copy. Every Circuit answer is true of the code. */
type Seed = [id: string, kind: Kind, topic: string, question: string, options: string[], answer: number, why: string];
const SEED: Seed[] = [
  ["c01", "circuit", "Sign-off", "Who can sign a post off for publishing?",
    ["Any signed-in account", "A Marketing Manager or the Admin", "Only the person who wrote it", "A Marketing Executive"], 1,
    "Signing off needs the approve grant, which the Manager and the Admin have and the Executive does not."],
  ["c02", "circuit", "Sign-off", "A post is signed off and then somebody changes one word of the caption. What happens?",
    ["Nothing — it was already approved", "The sign-off is void and it has to be signed off again", "It publishes with the old caption", "Circuit fixes the word back"], 1,
    "An approval covers the exact words and picture. Change either and it no longer applies."],
  ["c03", "circuit", "Sign-off", "Why does every Instagram post need a person's sign-off before it goes out?",
    ["Instagram charges for each post", "A published post cannot be deleted through the API, so a mistake is permanent", "ChatGPT cannot write captions", "Meta requires two logins"], 1,
    "Publishing is irreversible from Circuit, so a second person decides it is ready."],
  ["c04", "circuit", "Comments", "How does a comment get onto a LinkedIn or X post?",
    ["Circuit posts it automatically", "Circuit finds the post and writes options; a person opens the post and leaves the comment", "A bot logs in as you", "It is emailed to LinkedIn"], 1,
    "Automating LinkedIn or X through the browser breaks their terms and risks the account."],
  ["c05", "circuit", "Comments", "How many comment options does Circuit write for each post?", ["One", "Three", "Five", "Ten"], 2,
    "Five angles: an answer, a number, a question, an experience and a respectful pushback."],
  ["c06", "circuit", "Comments", "Circuit cannot search X for posts. What do you do instead?",
    ["Nothing — X is not supported", "Paste the post's link and Circuit fetches it and writes the options", "Log Circuit into X", "Copy the post into a document"], 1,
    "X posts are not indexed by search engines, so a found post is pasted in by link."],
  ["c07", "circuit", "Roles", "Who can see salaries, opex and the P&L?", ["Everyone", "The Marketing Manager and the Admin", "Only the Admin", "Nobody — it is not stored"], 2,
    "Finance is the Admin's alone. Reports show the Manager and the Executive no money columns."],
  ["c08", "circuit", "Roles", "Which of these can a Marketing Executive do?",
    ["Sign off a post", "Change the API keys in Settings", "Make and schedule posts and take the learning tests", "Add a new account"], 2,
    "The Executive creates; signing off, settings and accounts belong to the Manager or the Admin."],
  ["c09", "circuit", "Daily intel", "When does the daily intel briefing arrive by email?", ["06:00", "09:30", "13:00", "Only when asked"], 1,
    "The morning routine sweeps ten verticals and emails the scored briefing at 09:30."],
  ["c10", "circuit", "Routines", "A scheduled routine's last run is still waiting on a person. What happens to its next run?",
    ["It runs anyway", "It is held until the waiting run is cleared", "It is deleted", "It runs twice to catch up"], 1,
    "A waiting run blocks the next one, so two half-finished runs never pile up."],
  ["c11", "circuit", "Writing", "Which claims can Circuit put in a caption?",
    ["Anything on the website", "Only claims somebody has signed off in What we know", "Whatever ChatGPT finds", "Claims from competitors' posts"], 1,
    "Captions draw only on approved claims, so nothing is said that nobody has checked."],
  ["c12", "circuit", "Performance", "Where do the reach and saves for each of our Instagram posts come from?",
    ["Typed in every week", "Pulled from Meta's API by Circuit", "Estimated by ChatGPT", "A screenshot"], 1,
    "Circuit reads them from our own account through the Meta Graph API."],
  ["c13", "circuit", "Crons", "Where do you check whether the Meta connection is working?", ["Home", "Crons", "Library", "Calendar"], 1,
    "Crons lists every connection, bot and routine with whether it is working now."],
  ["c14", "circuit", "Work", "On the Work board, what does opening a piece of work's door do?",
    ["Deletes it", "Starts the part of that work Circuit can do", "Emails the team", "Marks it done"], 1,
    "Every task has a purpose and a door; the door begins what Circuit can do for it."],
  ["c16", "circuit", "Opex", "How does the monthly AI cost get into opex and the P&L?",
    ["Someone types it every month", "Circuit counts it from the AI tool bills automatically", "ChatGPT estimates it", "It is left out of the P&L"], 1,
    "A bill whose vendor is an AI tool, or whose category is ai, is counted as opex for its month — nobody retypes it."],
  ["c17", "circuit", "Image database", "Where do the raw photographs and video from a shoot go?",
    ["Inspiration", "The Image database — added by hand, ours and safe to use", "Poster studio", "They are not kept"], 1,
    "The Image database holds only what a person added, so it can be trusted as the source for every post."],
  ["c18", "circuit", "Manpower", "A salary has been entered for someone who joined in August. What happens in October?",
    ["It has to be entered again", "It is carried into October's manpower cost automatically", "It is dropped after one month", "ChatGPT adjusts it"], 1,
    "A salary is entered once and counted every month until the person's end date."],
  ["c15", "circuit", "Automation share", "In Circuit's automation share, a workstream that is partly automated counts as…",
    ["Fully automated", "Half", "Nothing", "Twice"], 1,
    "Full counts one, partial half, manual nothing. A rough measure, stated as one."],

  ["m01", "marketing", "Metrics", "Reach and impressions differ how?",
    ["They are the same", "Reach counts unique accounts; impressions count every view", "Impressions count unique accounts; reach counts every view", "Reach is paid; impressions are organic"], 1,
    "One person seeing a post three times is one reach and three impressions."],
  ["m02", "marketing", "Metrics", "Click-through rate is…", ["Clicks ÷ impressions", "Clicks ÷ followers", "Likes ÷ reach", "Sales ÷ clicks"], 0,
    "CTR is the share of people shown something who clicked it."],
  ["m03", "marketing", "Metrics", "A common way to work out a post's engagement rate is…",
    ["Followers ÷ posts", "Interactions ÷ reach", "Reach ÷ impressions", "Comments ÷ likes"], 1,
    "Likes, comments, saves and shares divided by the people reached."],
  ["m04", "marketing", "Metrics", "ROAS stands for and is calculated as…",
    ["Return on ad spend: revenue ÷ ad spend", "Rate of audience share: reach ÷ followers", "Return on all sales: profit ÷ revenue", "Reach over ad spend: reach ÷ spend"], 0,
    "₹4 of revenue for every ₹1 of ads is a ROAS of 4."],
  ["m05", "marketing", "Metrics", "Cost per lead is…", ["Spend ÷ leads", "Leads ÷ spend", "Spend ÷ clicks", "Revenue ÷ leads"], 0,
    "What it cost, on average, to get one enquiry."],
  ["m06", "marketing", "Metrics", "Customer acquisition cost includes…",
    ["Only ad spend", "All sales and marketing cost to win new customers, divided by the customers won", "The price of the product", "Only salaries"], 1,
    "CAC counts everything spent winning customers, not just the ads."],
  ["m07", "marketing", "Tracking", "Which three UTM tags are the usual minimum on a link?",
    ["utm_source, utm_medium, utm_campaign", "utm_name, utm_date, utm_user", "utm_click, utm_view, utm_buy", "utm_brand, utm_post, utm_page"], 0,
    "Source says where, medium says how, campaign says why."],
  ["m08", "marketing", "Testing", "In an A/B test of an ad, you should change…",
    ["Everything at once", "One thing at a time", "Only the budget", "Nothing — run both for a year"], 1,
    "Change one thing and you know what caused the difference."],
  ["m09", "marketing", "Funnel", "A fleet manager comparing EV bikes against petrol ones is at which stage?",
    ["Awareness", "Consideration", "Retention", "Advocacy"], 1,
    "They know they have a need and are weighing options — case studies and cost comparisons land here."],
  ["m10", "marketing", "Funnel", "Which content best serves the decision stage for a B2B buyer?",
    ["A meme", "A total-cost-of-ownership comparison and a customer case study", "A festival greeting", "A behind-the-scenes reel"], 1,
    "At decision, buyers want proof and numbers they can take to their finance team."],
  ["m11", "marketing", "Content", "What are content pillars?",
    ["The most expensive posts", "The few recurring themes a brand posts about", "Paid partnerships", "The pinned posts"], 1,
    "Pillars keep a calendar balanced and recognisable."],
  ["m12", "marketing", "Content", "A customer testimonial in a post is an example of…", ["Scarcity", "Social proof", "Retargeting", "SEO"], 1,
    "People trust what other customers say more than what the brand says."],
  ["m13", "marketing", "Content", "A call to action should be…", ["Vague so nobody feels pushed", "One clear next step", "Three options at once", "Left to the comments"], 1,
    "One clear next step converts better than several competing ones."],
  ["m14", "marketing", "Paid", "Retargeting means…",
    ["Showing ads to people who have already interacted with you", "Changing an ad's target mid-campaign", "Reposting old content", "Targeting competitors' staff"], 0,
    "It reaches people who visited, watched or engaged and did not act yet."],
  ["m15", "marketing", "Website", "Bounce rate is the share of visits that…",
    ["Bought something", "Left after one page without interacting", "Came from ads", "Filled a form"], 1,
    "A high bounce rate on a landing page often means the page does not match the ad."],
  ["m16", "marketing", "Brand", "Why keep brand guidelines?",
    ["To slow work down", "So everything looks and sounds like one company whoever makes it", "Because the law requires it", "To replace a content calendar"], 1,
    "Consistency is what makes a brand recognisable."],
  ["m17", "marketing", "Positioning", "A USP is…", ["A unique selling proposition — why buy from us and not them", "A universal sales price", "A user survey panel", "A kind of ad format"], 0,
    "The one reason a buyer should choose us."],
  ["m18", "marketing", "Lead generation", "A lead magnet is…",
    ["Something useful given in exchange for contact details", "A paid list of phone numbers", "A pop-up that cannot be closed", "A discount for existing customers"], 0,
    "A cost calculator or guide offered for an email address is a lead magnet."],
  ["m19", "marketing", "Organic and paid", "Organic reach is…", ["Reach bought through ads", "Reach earned without paying for it", "Reach from influencers only", "Reach in rural areas"], 1,
    "What a post reaches on its own, before any boost."],
  ["m20", "marketing", "Measurement", "A post had high reach but almost no saves or comments. The likeliest reading is…",
    ["It worked perfectly", "It was seen but did not give people a reason to act", "Instagram is broken", "The caption was too short"], 1,
    "Reach says it was shown; interactions say it was worth something to the people who saw it."],
];

function ensureSeed() {
  const db = getDb();
  const put = db.prepare(`INSERT OR IGNORE INTO learning_questions (id, kind, topic, question, options, answer, why, source, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'seed', 'live', ?)`);
  const at = now();
  /* The course's own checks are kept in step with lib/syllabus.ts: a corrected question or
     answer there corrects it here, without touching whether a manager retired it. */
  const course = db.prepare(`INSERT INTO learning_questions (id, kind, topic, question, options, answer, why, source, status, created_at)
    VALUES (?, 'marketing', ?, ?, ?, ?, ?, 'syllabus', 'live', ?)
    ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, question = excluded.question, options = excluded.options, answer = excluded.answer, why = excluded.why`);
  db.transaction(() => {
    for (const [id, kind, topic, q, opts, a, why] of SEED) put.run(`seed-${id}`, kind, topic, q, JSON.stringify(opts), a, why, at);
    for (const l of ALL_LESSONS) l.checks.forEach(([q, opts, a, why], i) => course.run(questionId(l.id, i), l.title, q, JSON.stringify(opts), a, why, at));
  })();
}

export function listQuestions(opts: { status?: string; kind?: string } = {}): Question[] {
  ensureSeed();
  const where: string[] = []; const args: string[] = [];
  if (opts.status) { where.push("status = ?"); args.push(opts.status); }
  if (opts.kind && isKind(opts.kind)) { where.push("kind = ?"); args.push(opts.kind); }
  const rows = getDb().prepare(`SELECT * FROM learning_questions ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'live' THEN 1 ELSE 2 END, kind, created_at DESC`).all(...args) as Row[];
  return rows.map(fromRow);
}

export function bankCounts(): Record<Kind, number> {
  ensureSeed();
  const out = { circuit: 0, platforms: 0, marketing: 0 } as Record<Kind, number>;
  for (const r of getDb().prepare("SELECT kind, COUNT(*) n FROM learning_questions WHERE status = 'live' GROUP BY kind").all() as { kind: Kind; n: number }[]) {
    if (isKind(r.kind)) out[r.kind] = r.n;
  }
  return out;
}

/* ── taking a test ─────────────────────────────────────────────────────── */

export type Taker = { id: string; name: string };
export type Attempt = {
  id: string; user_id: string; user_name: string; kind: string; question_ids: string[]; orders: number[][]; answers: number[] | null;
  score: number | null; total: number; started_at: string; finished_at: string | null;
};
type AttemptRow = Omit<Attempt, "question_ids" | "orders" | "answers"> & { question_ids: string; orders: string; answers: string | null };
const attemptFrom = (r: AttemptRow): Attempt => ({
  ...r, question_ids: JSON.parse(r.question_ids), orders: JSON.parse(r.orders || "[]"), answers: r.answers ? JSON.parse(r.answers) : null,
});

const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* What the taker sees: the question and its options, never the answer.

   The options are shuffled for every test and the order kept with the attempt. Without it the
   bank's habit of putting the right answer second meant "always B" passed. `order[i]` is the
   bank index of the option shown in position i. */
export type Asked = { id: string; kind: Kind; topic: string; question: string; options: string[] };
const asked = (q: Question, order = q.options.map((_, i) => i)): Asked =>
  ({ id: q.id, kind: q.kind, topic: q.topic, question: q.question, options: order.map((i) => q.options[i]) });

/* What a test draws from: a kind of question, everything, one lesson's check, or a level. */
function poolFor(kind: string): { pool: Question[]; ordered: boolean } {
  const live = listQuestions({ status: "live" });
  if (kind.startsWith("lesson:")) {
    const l = lessonById(kind.slice(7));
    if (!l) throw new Error("That lesson was not found.");
    const ids = l.checks.map((_, i) => questionId(l.id, i));
    return { pool: ids.flatMap((id) => live.filter((q) => q.id === id)), ordered: true };
  }
  if (kind.startsWith("level:")) {
    const lv = levelByKey(kind.slice(6));
    if (!lv) throw new Error("That level was not found.");
    const prefixes = lv.lessons.map((l) => `syl-${l.id}-`);
    return { pool: live.filter((q) => prefixes.some((p) => q.id.startsWith(p))), ordered: false };
  }
  return { pool: kind === "mixed" ? live : live.filter((q) => q.kind === kind), ordered: false };
}

export function startTest(who: Taker, kind: string): { attempt: string; questions: Asked[] } {
  const { pool, ordered } = poolFor(kind);
  if (!pool.length) throw new Error("There are no questions of that kind yet. Ask a Marketing Manager to add some.");
  /* Questions this person has not seen come first, so a second test is not the first one again. */
  const seen = new Set((getDb().prepare("SELECT question_ids FROM learning_attempts WHERE user_id = ?").all(who.id) as { question_ids: string }[])
    .flatMap((r) => JSON.parse(r.question_ids) as string[]));
  const fresh = shuffle(pool.filter((q) => !seen.has(q.id)));
  const again = shuffle(pool.filter((q) => seen.has(q.id)));
  const picked = ordered ? pool : [...fresh, ...again].slice(0, TEST_SIZE);
  const orders = picked.map((q) => shuffle(q.options.map((_, i) => i)));
  const id = newId();
  getDb().prepare(`INSERT INTO learning_attempts (id, user_id, user_name, kind, question_ids, orders, total, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, who.id, who.name, isKind(kind) || /^(lesson|level):[a-z0-9]+$/.test(kind) ? kind : "mixed", JSON.stringify(picked.map((q) => q.id)), JSON.stringify(orders), picked.length, now());
  return { attempt: id, questions: picked.map((q, i) => asked(q, orders[i])) };
}

export type Marked = Asked & { chose: number; answer: number; right: boolean; why: string };

export function submitTest(who: Taker, attemptId: string, answers: number[]): { score: number; total: number; percent: number; passed: boolean; marked: Marked[] } {
  const db = getDb();
  const row = db.prepare("SELECT * FROM learning_attempts WHERE id = ?").get(attemptId) as AttemptRow | undefined;
  if (!row) throw new Error("That test was not found.");
  const a = attemptFrom(row);
  if (a.user_id !== who.id) throw new Error("That test belongs to somebody else.");
  if (a.finished_at) throw new Error("That test has already been handed in.");
  const byId = new Map(listQuestions().map((q) => [q.id, q]));
  const marked: Marked[] = a.question_ids.flatMap((qid, i) => {
    const q = byId.get(qid);
    if (!q) return [];
    const order = a.orders[i] || q.options.map((_, j) => j);
    const chose = Number.isInteger(answers[i]) && answers[i] >= 0 && answers[i] < order.length ? answers[i] : -1;
    const answer = order.indexOf(q.answer);
    return [{ ...asked(q, order), chose, answer, right: chose === answer, why: q.why }];
  });
  const score = marked.filter((m) => m.right).length;
  db.prepare("UPDATE learning_attempts SET answers = ?, score = ?, total = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(marked.map((m) => m.chose)), score, marked.length, now(), a.id);
  const percent = marked.length ? Math.round((score / marked.length) * 100) : 0;
  /* A lesson's three-question check passes on two right; everything else on the usual mark. */
  const passed = a.kind.startsWith("lesson:") ? score >= Math.min(LESSON_PASS, marked.length) : percent >= PASS_MARK;
  return { score, total: marked.length, percent, passed, marked };
}

/* ── the course ────────────────────────────────────────────────────────── */

export type Progress = { lessons: Record<string, { passed: boolean; best: number; total: number }>; levels: Record<string, { passed: boolean; best: number; tries: number }> };

/* Where somebody is in the course, read from the tests they have handed in. */
export function progressOf(userId: string): Progress {
  const rows = getDb().prepare("SELECT kind, score, total FROM learning_attempts WHERE user_id = ? AND finished_at IS NOT NULL AND (kind LIKE 'lesson:%' OR kind LIKE 'level:%')")
    .all(userId) as { kind: string; score: number; total: number }[];
  const out: Progress = { lessons: {}, levels: {} };
  for (const r of rows) {
    if (r.kind.startsWith("lesson:")) {
      const k = r.kind.slice(7);
      const was = out.lessons[k] || { passed: false, best: 0, total: r.total };
      out.lessons[k] = { passed: was.passed || r.score >= Math.min(LESSON_PASS, r.total), best: Math.max(was.best, r.score), total: r.total };
    } else {
      const k = r.kind.slice(6);
      const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
      const was = out.levels[k] || { passed: false, best: 0, tries: 0 };
      out.levels[k] = { passed: was.passed || pct >= PASS_MARK, best: Math.max(was.best, pct), tries: was.tries + 1 };
    }
  }
  return out;
}

/* For the Manager and the Admin: how far each person has got through the course. */
export function teamCourse(): { user_id: string; name: string; lessons: number; levels: string[] }[] {
  const ids = getDb().prepare("SELECT DISTINCT user_id, user_name FROM learning_attempts WHERE finished_at IS NOT NULL").all() as { user_id: string; user_name: string }[];
  return ids.map(({ user_id, user_name }) => {
    const p = progressOf(user_id);
    return {
      user_id, name: user_name,
      lessons: Object.values(p.lessons).filter((x) => x.passed).length,
      levels: LEVELS.filter((l) => p.levels[l.key]?.passed).map((l) => l.label),
    };
  });
}

export function myAttempts(userId: string) {
  return (getDb().prepare("SELECT * FROM learning_attempts WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 20").all(userId) as AttemptRow[])
    .map(attemptFrom).map(({ id, kind, score, total, finished_at }) => ({ id, kind, score, total, finished_at }));
}

/* For the Manager and the Admin: how each person is doing, and where they are weakest. */
export function teamScores() {
  const rows = (getDb().prepare("SELECT * FROM learning_attempts WHERE finished_at IS NOT NULL ORDER BY finished_at").all() as AttemptRow[]).map(attemptFrom);
  const byId = new Map(listQuestions().map((q) => [q.id, q]));
  const people = new Map<string, { user_id: string; name: string; tests: number; last: number; average: number; sum: number; last_at: string; misses: Map<string, number> }>();
  for (const a of rows) {
    const pct = a.total ? Math.round(((a.score || 0) / a.total) * 100) : 0;
    const p = people.get(a.user_id) || { user_id: a.user_id, name: a.user_name, tests: 0, last: 0, average: 0, sum: 0, last_at: "", misses: new Map() };
    p.tests += 1; p.sum += pct; p.last = pct; p.last_at = a.finished_at || ""; p.name = a.user_name;
    a.question_ids.forEach((qid, i) => {
      const q = byId.get(qid);
      const order = a.orders[i] || [];
      const chose = a.answers ? a.answers[i] : -1;
      const bankIndex = order.length ? order[chose] : chose;
      if (q && bankIndex !== q.answer) p.misses.set(q.topic, (p.misses.get(q.topic) || 0) + 1);
    });
    people.set(a.user_id, p);
  }
  return [...people.values()].map(({ misses, sum, ...p }) => ({
    ...p, average: Math.round(sum / p.tests),
    weakest: [...misses.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([t]) => t),
  })).sort((x, y) => y.last_at.localeCompare(x.last_at));
}

/* ── the bank ──────────────────────────────────────────────────────────── */

export function setStatus(id: string, status: "live" | "retired") {
  const r = getDb().prepare("UPDATE learning_questions SET status = ? WHERE id = ?").run(status, id);
  if (!r.changes) throw new Error("Question not found.");
}

const PLATFORM_FACTS = () => [
  ...MODULES.map((m) => `- ${m.name} (${m.page}, ${m.auto}): ${m.does} A person: ${m.person}`),
  ...ROLES.map((r) => `- Login "${r.label}": ${r.what}`),
  "- Sign-off: a post needs a Marketing Manager or the Admin to sign it off; any change to the words or picture voids it. Instagram posts cannot be deleted through the API.",
  "- Engager (formerly Comments): Circuit finds LinkedIn and X posts by search, takes LinkedIn, X, Instagram and Facebook posts by pasted link, and writes five options per post (answer, number, question, experience, pushback). A person leaves the comment; the day's goal is five.",
  "- Captions use only claims approved in What we know.",
].join("\n");

/* ChatGPT writes new questions; they wait as drafts until somebody passes them. "platforms"
   searches the web for what changed recently, and must say where each fact came from. */
export async function generateQuestions(kind: string, topic: string, count: number): Promise<Question[]> {
  if (!isKind(kind)) throw new Error("Choose our platform, platform updates or marketing.");
  const n = Math.max(1, Math.min(10, Math.round(count) || 5));
  const existing = listQuestions({ kind }).map((q) => `- ${q.question}`).slice(0, 60).join("\n");
  const brief =
    kind === "circuit" ? `Write questions that test whether a marketing executive understands how our platform, Circuit, works. Use ONLY these facts — do not invent features:\n${PLATFORM_FACTS()}` :
    kind === "platforms" ? `Search the web for changes made in the last six months by Instagram, Facebook/Meta, LinkedIn and X that matter to a brand's marketing team (algorithm, formats, limits, ads, analytics). Write questions only about changes you found in an official announcement or a reputable trade publication, and put that source's name and month in "source".` :
    `Write questions on general marketing craft for an executive at an Indian electric-motorcycle maker selling to fleets and riders: metrics, funnels, tracking, testing, content, paid media, B2B buying.`;
  const prompt = `${brief}
${topic ? `Focus on: ${topic}\n` : ""}
Write ${n} multiple-choice questions. Each has exactly four options, one correct. Wrong options must be plausible, not silly. Keep each question under 30 words. "why" is one sentence explaining the right answer.
Do not repeat any of these existing questions:
${existing || "(none yet)"}

Reply with JSON only: {"questions":[{"topic":"short topic","question":"…","options":["…","…","…","…"],"answer":0,"why":"…","source":"…"}]}`;
  const raw = (await runChatGptJson(prompt, { search: kind === "platforms", timeoutMs: 8 * 60 * 1000 })) as { questions?: unknown[] };
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  const db = getDb();
  const put = db.prepare(`INSERT INTO learning_questions (id, kind, topic, question, options, answer, why, source, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`);
  const made: Question[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const options = Array.isArray(x.options) ? x.options.map(String).filter(Boolean) : [];
    const answer = Number(x.answer);
    const question = String(x.question || "").trim();
    if (!question || options.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    const q: Question = {
      id: newId(), kind, topic: String(x.topic || topic || "General").slice(0, 60), question, options, answer,
      why: String(x.why || "").trim(), source: `chatgpt${x.source ? ` · ${String(x.source).slice(0, 120)}` : ""}`, status: "draft", created_at: now(),
    };
    put.run(q.id, q.kind, q.topic, q.question, JSON.stringify(q.options), q.answer, q.why, q.source, q.created_at);
    made.push(q);
  }
  if (!made.length) throw new Error("ChatGPT did not return any usable questions. Try again.");
  return made;
}
