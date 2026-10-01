import fs from "node:fs";
import path from "node:path";
import { getDb, getFile, newId, now, UPLOAD_DIR } from "@/lib/db";
import { runChatGptJson } from "@/lib/chatgpt";

/* Why a poster worked, not just that it did.

   Circuit already knows a post's reach and likes. What it never knew is what the picture
   actually showed — a rider or an empty bike, a clean frame or a wall of text, daylight or
   night, a number on the image or none. ChatGPT looks at each saved poster and describes it
   in fixed fields; those fields are then cut against the numbers, so the app can say
   "posts with a person in frame do 2.3× yours without one" instead of guessing.

   Nothing here is a judgement of quality: the model only describes what it can see. The
   ranking comes from your own results. */

export type PosterTags = {
  subject: string;          // what the picture is mainly of
  people: "none" | "one" | "group";
  product_shown: boolean;
  setting: string;          // studio, street, home, factory, showroom, outdoors
  time_of_day: "day" | "night" | "unclear";
  text_amount: "none" | "few words" | "a headline" | "heavy";
  text_on_image: string;    // the words actually visible, if any
  has_number: boolean;
  dominant_colours: string[];
  mood: string;
  style: string;            // photo, illustration, poster, screenshot, collage
  festive: boolean;
  logo_visible: boolean;
};

export type TaggedPoster = {
  id: string; own_post_id: string; ig_id: string; tags: PosterTags; tagged_at: string;
};

const FIELDS = `{"subject":"what the picture is mainly of, 3-6 words","people":"none|one|group","product_shown":true,"setting":"studio|street|home|factory|showroom|outdoors|other","time_of_day":"day|night|unclear","text_amount":"none|few words|a headline|heavy","text_on_image":"the words visible on the image, or empty","has_number":true,"dominant_colours":["2-3 plain colour names"],"mood":"2-4 words","style":"photo|illustration|poster|screenshot|collage","festive":false,"logo_visible":true}`;

export function untaggedPosters(limit = 6) {
  return getDb().prepare(`
    SELECT o.id, o.ig_id, o.file_id, o.caption FROM own_posts o
     WHERE o.file_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM poster_tags t WHERE t.own_post_id = o.id)
     ORDER BY o.posted_at DESC LIMIT ?
  `).all(limit) as { id: string; ig_id: string; file_id: string; caption: string }[];
}

export function taggedPosters(): TaggedPoster[] {
  const rows = getDb().prepare("SELECT id, own_post_id, ig_id, tags, tagged_at FROM poster_tags").all() as { id: string; own_post_id: string; ig_id: string; tags: string; tagged_at: string }[];
  return rows.flatMap((r) => {
    try { return [{ ...r, tags: JSON.parse(r.tags) as PosterTags }]; } catch { return []; }
  });
}

/* One run looks at a handful of posters at a time: each picture is attached and described.
   Read-only, on the owner's own ChatGPT sign-in, same as every other job in Circuit. */
export async function tagPosters(limit = 6): Promise<{ tagged: number; skipped: number; errors: string[] }> {
  const todo = untaggedPosters(limit);
  const out = { tagged: 0, skipped: 0, errors: [] as string[] };
  if (!todo.length) return out;

  const paths: string[] = [];
  const order: { id: string; ig_id: string }[] = [];
  for (const p of todo) {
    const f = getFile(p.file_id);
    // files are stored by name inside the uploads folder, so the full path is built here
    const full = f ? path.join(UPLOAD_DIR, f.path) : "";
    if (!f || !fs.existsSync(full)) { out.skipped++; continue; }
    paths.push(full);
    order.push({ id: p.id, ig_id: p.ig_id });
  }
  if (!paths.length) return out;

  const prompt = `You are describing marketing posters so their performance can be compared. ${paths.length} image${paths.length === 1 ? " is" : "s are"} attached, in order.
Describe each one exactly as you see it. Do not judge whether it is good, do not guess at anything not visible, and do not invent product details.
Return ONLY one JSON object, no commentary and no code fence:
{"posters":[${FIELDS}]}
Give one entry per attached image, in the same order.`;

  try {
    const answer = (await runChatGptJson(prompt, { search: false, images: paths, timeoutMs: 8 * 60 * 1000 })) as { posters?: PosterTags[] };
    const list = answer.posters || [];
    const db = getDb();
    const ins = db.prepare("INSERT INTO poster_tags (id, own_post_id, ig_id, tags, tagged_at) VALUES (?, ?, ?, ?, ?)");
    list.slice(0, order.length).forEach((tags, i) => {
      ins.run(newId(), order[i].id, order[i].ig_id, JSON.stringify(tags), now());
      out.tagged++;
    });
    if (!list.length) out.errors.push("ChatGPT described none of the posters");
  } catch (e) {
    out.errors.push((e as Error).message);
  }
  return out;
}

export function postersLeft() {
  return (getDb().prepare(`SELECT COUNT(*) n FROM own_posts o WHERE o.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM poster_tags t WHERE t.own_post_id = o.id)`).get() as { n: number }).n;
}
