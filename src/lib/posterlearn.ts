import { getDb } from "@/lib/db";
import { taggedPosters, type PosterTags } from "@/lib/postertags";

/* What the posters that worked have in common.

   Each saved poster has been described in fixed fields (people, text amount, setting, time of
   day, colour, festive, and so on). Here those fields are cut against the numbers the post
   actually earned, and only differences big enough and backed by enough posts are reported.
   Two posts are an anecdote; the bar is MIN_EACH on both sides and a real gap between them. */

export const MIN_EACH = 3;
const GAP = 1.25; // one side must earn at least a quarter more than the other to be worth saying

export type Split = {
  key: string; label: string;
  a: { label: string; posts: number; engagement: number; reach: number | null };
  b: { label: string; posts: number; engagement: number; reach: number | null };
  times: number; winner: string; solid: boolean;
};
export type PosterLearned = {
  tagged: number; untagged: number; average: number;
  splits: Split[]; advice: string[];
  best: { ig_id: string; permalink: string; file_id: string | null; engagement: number; reach: number | null; times: number; subject: string; text_on_image: string }[];
};

type Row = { own_post_id: string; ig_id: string; permalink: string; file_id: string | null; engagement: number; reach: number | null; tags: PosterTags };

function rows(): Row[] {
  const tagged = taggedPosters();
  if (!tagged.length) return [];
  const byId = new Map(tagged.map((t) => [t.own_post_id, t.tags]));
  const posts = getDb().prepare("SELECT id, ig_id, permalink, file_id, likes, comments, reach, saved, shares FROM own_posts").all() as
    { id: string; ig_id: string; permalink: string; file_id: string | null; likes: number; comments: number; reach: number | null; saved: number | null; shares: number | null }[];
  return posts.flatMap((p) => {
    const tags = byId.get(p.id);
    if (!tags) return [];
    return [{
      own_post_id: p.id, ig_id: p.ig_id, permalink: p.permalink, file_id: p.file_id,
      engagement: p.likes + p.comments + (p.saved || 0) + (p.shares || 0),
      reach: p.reach, tags,
    }];
  });
}

const avg = (list: number[]) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
const avgReach = (list: Row[]) => {
  const vals = list.map((r) => r.reach).filter((v): v is number => typeof v === "number");
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
};

/* One comparison: posters where a thing is true against posters where it isn't. */
function split(list: Row[], key: string, label: string, test: (t: PosterTags) => boolean | null, aLabel: string, bLabel: string): Split | null {
  const a = list.filter((r) => test(r.tags) === true);
  const b = list.filter((r) => test(r.tags) === false);
  if (!a.length || !b.length) return null;
  const ea = avg(a.map((r) => r.engagement));
  const eb = avg(b.map((r) => r.engagement));
  if (!ea || !eb) return null;
  const times = Math.round((Math.max(ea, eb) / Math.min(ea, eb)) * 10) / 10;
  return {
    key, label,
    a: { label: aLabel, posts: a.length, engagement: ea, reach: avgReach(a) },
    b: { label: bLabel, posts: b.length, engagement: eb, reach: avgReach(b) },
    times,
    winner: ea >= eb ? aLabel : bLabel,
    solid: a.length >= MIN_EACH && b.length >= MIN_EACH && times >= GAP,
  };
}

export function posterLearned(): PosterLearned {
  const list = rows();
  const untagged = (getDb().prepare("SELECT COUNT(*) n FROM own_posts WHERE file_id IS NOT NULL AND id NOT IN (SELECT own_post_id FROM poster_tags)").get() as { n: number }).n;
  const average = avg(list.map((r) => r.engagement));

  const splits = [
    split(list, "people", "Someone in the picture", (t) => t.people !== "none", "a person in frame", "no people"),
    split(list, "product", "The bike in the picture", (t) => Boolean(t.product_shown), "product shown", "no product"),
    split(list, "text", "Words on the picture", (t) => t.text_amount === "none" ? false : t.text_amount === "heavy" ? null : true, "a headline or few words", "no text at all"),
    split(list, "heavy", "How much text", (t) => t.text_amount === "heavy" ? true : t.text_amount === "none" ? null : false, "heavy text", "light text"),
    split(list, "number", "A number on the picture", (t) => Boolean(t.has_number), "shows a number", "no number"),
    split(list, "night", "Time of day", (t) => t.time_of_day === "unclear" ? null : t.time_of_day === "night", "shot at night", "shot in daylight"),
    split(list, "festive", "Festive posters", (t) => Boolean(t.festive), "festive", "everyday"),
    split(list, "outdoors", "Where it was shot", (t) => ["street", "outdoors"].includes(t.setting) ? true : ["studio", "showroom"].includes(t.setting) ? false : null, "out on the street", "studio or showroom"),
    split(list, "logo", "The logo", (t) => Boolean(t.logo_visible), "logo visible", "no logo"),
  ].filter((x): x is Split => Boolean(x)).sort((a, b) => Number(b.solid) - Number(a.solid) || b.times - a.times);

  const advice = splits.filter((s) => s.solid).slice(0, 5).map((s) => {
    const win = s.winner === s.a.label ? s.a : s.b;
    const lose = s.winner === s.a.label ? s.b : s.a;
    return `Posters with ${win.label} earn ${s.times}× the ones with ${lose.label} (${win.engagement} against ${lose.engagement} interactions, across ${win.posts} and ${lose.posts} posts).`;
  });

  const best = [...list]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 4)
    .map((r) => ({
      ig_id: r.ig_id, permalink: r.permalink, file_id: r.file_id,
      engagement: r.engagement, reach: r.reach,
      times: average ? Math.round((r.engagement / average) * 10) / 10 : 0,
      subject: r.tags.subject || "",
      text_on_image: r.tags.text_on_image || "",
    }));

  return { tagged: list.length, untagged, average, splits, advice, best };
}

/* The same findings in one short paragraph, for the prompt that draws the next poster.
   Silent when nothing is solid enough to say, so a draft is never nudged by noise. */
export function posterGuidance(): string {
  const l = posterLearned();
  if (!l.advice.length) return "";
  const points = l.splits.filter((s) => s.solid).slice(0, 4).map((s) => {
    const win = s.winner === s.a.label ? s.a.label : s.b.label;
    return `${win} (${s.times}x)`;
  });
  return `What has worked on this brand's own Instagram, from ${l.tagged} posts: ${points.join(", ")}. Lean this way unless the topic says otherwise.`;
}
