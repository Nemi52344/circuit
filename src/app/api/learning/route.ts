import { handleUser, handleCan, ok, bad, readJson } from "@/lib/http";
import { can } from "@/lib/roles";
import {
  KINDS, TEST_SIZE, PASS_MARK, bankCounts, listQuestions, startTest, submitTest, myAttempts, teamScores, setStatus, generateQuestions,
  progressOf, teamCourse,
} from "@/lib/learning";
import { LEVELS, LESSON_PASS } from "@/lib/syllabus";
import { MODULES } from "@/lib/modules";

export const runtime = "nodejs";

/* Anyone signed in takes tests. The bank with its answers, the team's scores and new questions
   are for whoever can run the marketing — the Manager and the Admin. */

const taker = (user: { id: string; name: string } | null) => user || { id: "local", name: "This Mac" };

export const GET = handleUser(async (_req, user) => {
  const runs = can(user, "manage");
  return ok({
    kinds: KINDS, size: TEST_SIZE, pass: PASS_MARK, counts: bankCounts(), modules: MODULES,
    mine: myAttempts(taker(user).id),
    /* The course: its lessons go to everyone in full — they are reading, not a test — and the
       checks' answers stay in the bank like every other question's. */
    levels: LEVELS.map((l) => ({ ...l, lessons: l.lessons.map(({ checks, ...x }) => ({ ...x, checks: checks.length })) })),
    lesson_pass: LESSON_PASS,
    progress: progressOf(taker(user).id),
    can_manage: runs,
    team: runs ? teamScores() : null,
    team_course: runs ? teamCourse() : null,
    bank: runs ? listQuestions() : null,
  });
});

export const POST = handleUser(async (req, user) => {
  const b = await readJson<{ action?: string; kind?: string; attempt?: string; answers?: number[] }>(req);
  try {
    if (b.action === "start") return ok(startTest(taker(user), b.kind || "mixed"), 201);
    if (b.action === "submit") {
      if (!b.attempt || !Array.isArray(b.answers)) return bad("attempt and answers required");
      return ok(submitTest(taker(user), b.attempt, b.answers));
    }
  } catch (e) { return bad((e as Error).message); }
  return bad("Unknown action");
});

export const PATCH = handleCan("manage", async (req) => {
  const b = await readJson<{ action?: string; id?: string; kind?: string; topic?: string; count?: number }>(req);
  try {
    if (b.action === "generate") return ok({ made: await generateQuestions(b.kind || "", b.topic || "", b.count || 5) }, 201);
    if ((b.action === "live" || b.action === "retired") && b.id) { setStatus(b.id, b.action); return ok({ ok: true }); }
  } catch (e) { return bad((e as Error).message); }
  return bad("Unknown action");
});
