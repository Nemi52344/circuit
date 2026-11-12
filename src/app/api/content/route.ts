import { getDb, getAccountsDb, getFile, newId, now } from "@/lib/db";
import { handleUser, handleCan, ok, bad, readJson } from "@/lib/http";
import { setMedia, CAROUSEL_MAX } from "@/lib/publish";
import { can } from "@/lib/roles";
import { stateOf, isVideoPost } from "@/lib/signoff";
import { postVerdict, slotVerdict, COLUMNS, type Verdict } from "@/lib/contentstatus";

/* Every piece of content and where it stands — the Content status board. Posts, plus calendar
   slots that have no post yet. Posted work is shown for thirty days; anything older is history
   and lives on the Reports page. Approving, sending back and publishing are done through the
   routes that already guard them (/api/signoff, /api/posting). */
export const runtime = "nodejs";

export type Piece = Verdict & {
  key: string; post_id: string | null; post_ids: string[]; slot_id: string | null; title: string; when: string;
  platform: string; format: string; is_video: boolean; file_id: string | null; caption: string;
  posted_url: string; decided_by: string; note: string;
  /* How far along: a slot's stage out of eight; a post is past all of them. And how many
     pictures it carries, so a carousel says so. */
  stage: number; slides: number;
};

export const GET = handleUser(async (_req, user) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const approvers = (getAccountsDb().prepare("SELECT role FROM users WHERE active = 1").all() as { role: string }[]).some((u) => can(u, "approve"));

  const posts = db.prepare(`
    SELECT p.id, p.platform, p.caption, p.scheduled_at, p.status, p.posted_url, p.slot_id,
           COALESCE(p.file_id, c.file_id) AS file_id, s.topic, s.format
    FROM posts p LEFT JOIN creations c ON c.id = p.creation_id LEFT JOIN slots s ON s.id = p.slot_id
    WHERE p.status <> 'posted' OR substr(p.updated_at, 1, 10) >= ?
    ORDER BY p.scheduled_at`).all(since) as { id: string; platform: string; caption: string; scheduled_at: string; status: string; posted_url: string; slot_id: string | null; file_id: string | null; topic: string | null; format: string | null }[];

  const slideCount = new Map((db.prepare("SELECT post_id, COUNT(*) AS n FROM post_media GROUP BY post_id").all() as { post_id: string; n: number }[]).map((r) => [r.post_id, r.n]));
  const perPost: Piece[] = posts.map((p) => {
    const st = stateOf(p.id);
    const video = isVideoPost(p.id);
    const signoff = !st?.signoff ? null : st.stale ? "stale" as const : st.signoff.decision;
    const v = postVerdict({ status: p.status, scheduled_at: p.scheduled_at, is_video: video, signoff, approvers }, today);
    return {
      ...v, key: `post:${p.id}`, post_id: p.id, post_ids: [p.id], slot_id: p.slot_id,
      title: p.topic || p.caption.split("\n")[0].slice(0, 90) || "Untitled post",
      when: p.scheduled_at, platform: p.platform, format: video ? "video" : p.format || "image", is_video: video,
      file_id: p.file_id, caption: p.caption, posted_url: p.posted_url,
      decided_by: st?.signoff?.by_name || "", note: st?.signoff?.note || "",
      stage: 8, slides: Math.max(1, (slideCount.get(p.id) as number | undefined) || 0),
    };
  });

  /* One card per piece of content, not per platform: the posts a calendar slot became are
     grouped, sit where the least-finished of them is, and are approved together. */
  const rank: Record<string, number> = { idea: 0, making: 1, signoff: 2, scheduled: 3, posted: 4 };
  const flagRank: Record<string, number> = { sent_back: 0, stale: 1, late: 2, due: 3, "": 4 };
  const groups = new Map<string, Piece[]>();
  /* A calendar slot's posts belong together; so do posts made together in the Studio — the same
     pictures going out at the same time on several platforms. */
  for (const p of perPost) {
    const k = p.slot_id ? `slot:${p.slot_id}` : p.file_id ? `media:${p.file_id}|${p.when}` : p.key;
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  const pieces: Piece[] = [...groups.entries()].map(([key, g]) => {
    const lead = [...g].sort((a, b) => rank[a.column] - rank[b.column] || flagRank[a.flag] - flagRank[b.flag])[0];
    const inLead = g.filter((x) => x.column === lead.column);
    return {
      ...lead, key, post_ids: inLead.map((x) => x.post_id!).filter(Boolean),
      platform: [...new Set(g.map((x) => x.platform))].join(", "),
      line: g.length > 1 && lead.column !== g[g.length - 1].column ? `${lead.line} · ${g.length} platforms` : lead.line,
    };
  });

  /* Slots with no post: ideas and work in progress, from a week back to two months ahead. */
  const slots = db.prepare(`
    SELECT s.id, s.date, s.time, s.topic, s.format, s.stage, s.status, s.platforms, cr.file_id
    FROM slots s LEFT JOIN creations cr ON cr.id = s.final_creation_id
    WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.slot_id = s.id)
      AND s.date >= ? AND s.date <= ? ORDER BY s.date, s.time`)
    .all(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), new Date(Date.now() + 62 * 86400000).toISOString().slice(0, 10)) as
    { id: string; date: string; time: string; topic: string; format: string; stage: number; status: string; platforms: string; file_id: string | null }[];
  for (const s of slots) {
    pieces.push({
      ...slotVerdict({ stage: s.stage, status: s.status }), key: `slot:${s.id}`, post_id: null, post_ids: [], slot_id: s.id,
      title: s.topic || "Not decided yet", when: `${s.date}T${s.time || "18:00"}`, platform: (() => { try { return (JSON.parse(s.platforms || "[]") as string[]).join(", "); } catch { return s.platforms; } })(),
      format: s.format || "image", is_video: s.format === "video", file_id: s.file_id, caption: "", posted_url: "", decided_by: "", note: "",
      stage: s.stage, slides: 1,
    });
  }
  return ok({ pieces, columns: COLUMNS, today, can_approve: can(user, "approve"), approvers });
});

/* Putting something made in the Studio on the calendar: one post per platform, every picture
   in order (a carousel when there is more than one). Posters then wait for sign-off on the
   board; videos go straight to Scheduled. */
const PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X"];

export const POST = handleCan("create", async (req) => {
  const b = await readJson<{ action?: string; file_ids?: string[]; caption?: string; date?: string; time?: string; platforms?: string[]; title?: string }>(req);
  if (b.action !== "schedule") return bad("Unknown action");
  const ids = (b.file_ids || []).filter((id) => getFile(id));
  if (!ids.length) return bad("Make something first");
  if (ids.length > CAROUSEL_MAX) return bad(`A carousel holds at most ${CAROUSEL_MAX} slides`);
  const platforms = (b.platforms || []).filter((p) => PLATFORMS.includes(p));
  if (!platforms.length) return bad("Pick at least one platform");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date! : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const time = /^\d{2}:\d{2}$/.test(b.time || "") ? b.time! : "18:00";
  const db = getDb();
  const made: string[] = [];
  for (const platform of platforms) {
    const id = newId();
    db.prepare(`INSERT INTO posts (id, platform, caption, file_id, creation_id, scheduled_at, status, posted_url, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, NULL, ?, 'scheduled', '', ?, ?, ?)`)
      .run(id, platform, (b.caption || "").trim().slice(0, 2200), ids[0], `${date}T${time}`, `Made in the Studio${b.title ? `: ${b.title}` : ""}`, now(), now());
    if (ids.length > 1) setMedia(id, ids);
    made.push(id);
  }
  return ok({ post_ids: made, date, time }, 201);
});
