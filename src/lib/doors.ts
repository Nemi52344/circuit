import { getDb, getSetting } from "@/lib/db";

/* What Circuit can actually do about a piece of work.

   A task used to be a row you looked at — a title, two dates and a percentage, pointing at
   nothing. Circuit already had the better idea in `slots`, which know what stage the work is at
   and what is needed next, and the board was a second task system that did none of the work.

   A door is the fix. Every piece of work either has something Circuit can run right now, or a
   screen where it is done with what Circuit already holds, or neither — and when it is neither,
   it says so plainly instead of pretending a dropdown is progress.

   The readiness line is computed against the database every time it is read, so it says "eleven
   photos on file" or "no product photo yet" rather than a guess made when the task was written. */

export type DoorKind = "run" | "open" | "yours";

export type Door = {
  key: string;
  kind: DoorKind;
  /* What the button or link says. */
  label: string;
  /* What happens when it is pressed, in one line. */
  what: string;
  /* Where a person goes, when the work is theirs. */
  href?: string;
  /* What Circuit holds for this, and what is missing. Read live. */
  holds: () => { ready: boolean; line: string };
  /* Only for kind "run". */
  run?: () => Promise<{ made: string; detail: string; href?: string }>;
};

/* Runs one of the actions a routine would run, and turns its answer into something a person
   reads. The action itself is not reimplemented here: the board presses the same button the
   morning routine does, so the two can never drift apart. */
async function viaAction(
  key: string,
  say: (output: unknown) => { made: string; detail: string; href?: string },
): Promise<{ made: string; detail: string; href?: string }> {
  const { runAction } = await import("@/lib/workflows");
  const r = await runAction(key as Parameters<typeof runAction>[0]);
  if (!r.ok) throw new Error(r.error || "Circuit could not do that just now");
  return say(r.output);
}

const one = (sql: string, ...a: unknown[]): number => {
  try { return (getDb().prepare(sql).get(...a) as { n: number }).n; } catch { return 0; }
};

const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

/* Competitors are a settings blob, not a table. */
const competitorCount = (): number => {
  try {
    const raw = getSetting("competitors") || "[]";
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch { return 0; }
};

const thisMonthKey = () => new Date().toISOString().slice(0, 7);

/* ---- the doors ---- */

const DOORS: Door[] = [
  /* ---- things Circuit runs ---- */
  {
    key: "fill_month",
    kind: "run",
    label: "Fill the month",
    what: "Lays out this month's posts from your pillars, with dates and platforms",
    holds: () => {
      const pillars = one("SELECT COUNT(*) n FROM pillars");
      const already = one("SELECT COUNT(*) n FROM slots WHERE substr(date,1,7) = ?", thisMonthKey());
      if (!pillars) return { ready: false, line: "No pillars set up yet — Settings decides what gets posted about" };
      return { ready: true, line: already ? `${plural(already, "post")} already on this month · ${plural(pillars, "pillar")}` : `${plural(pillars, "pillar")} to plan from` };
    },
    run: async () => {
      const { fillMonth } = await import("@/lib/slots");
      const before = one("SELECT COUNT(*) n FROM slots WHERE substr(date,1,7) = ?", thisMonthKey());
      fillMonth(thisMonthKey());
      const after = one("SELECT COUNT(*) n FROM slots WHERE substr(date,1,7) = ?", thisMonthKey());
      return { made: `${after - before} posts planned`, detail: `${after} on this month now`, href: "/" };
    },
  },
  {
    key: "topic_ideas",
    kind: "run",
    label: "Ask for topics",
    what: "Gets ChatGPT to suggest a topic for each post in the next fortnight that has none",
    holds: () => {
      /* The same conditions the action itself applies, rather than a looser count that reads
         well and then queues nothing. The first version said "18 planned posts with no topic"
         and the button came back with "0 queued", because the action only reaches a fortnight
         ahead and skips posts that already have ideas waiting against them. A readiness line
         that promises more than the button delivers is worse than no line. */
      const soon = one(`SELECT COUNT(*) n FROM slots s
        WHERE s.date BETWEEN date('now') AND date('now', '+14 day')
          AND TRIM(COALESCE(s.topic,'')) = '' AND s.status != 'posted'
          AND COALESCE(s.research,'') NOT LIKE '%"topic_ideas"%'
          AND NOT EXISTS (SELECT 1 FROM research_jobs j
                          WHERE j.slot_id = s.id AND j.kind = 'topics' AND j.status IN ('queued','running'))`);
      if (soon) return { ready: true, line: `${plural(soon, "post")} in the next fortnight with no topic` };
      const later = one("SELECT COUNT(*) n FROM slots WHERE TRIM(COALESCE(topic,'')) = '' AND date > date('now', '+14 day')");
      const waiting = one("SELECT COUNT(*) n FROM research_jobs WHERE kind = 'topics' AND status IN ('queued','running')");
      if (waiting) return { ready: false, line: `${plural(waiting, "topic")} already being worked on` };
      return {
        ready: false,
        line: later
          ? `Nothing in the next fortnight needs one — ${plural(later, "post")} further out will, nearer the time`
          : "Every planned post already has a topic",
      };
    },
    run: () => viaAction("ask_for_ideas", (o) => ({
      made: `${(o as { queued?: number })?.queued ?? 0} queued`,
      detail: "They appear against the posts as the answers come back",
      href: "/slots",
    })),
  },
  {
    key: "read_competitors",
    kind: "run",
    label: "Read them now",
    what: "Pulls what the competitors you follow have published in the last week",
    holds: () => {
      const n = competitorCount();
      const saved = one("SELECT COUNT(*) n FROM inspirations");
      if (!getSetting("meta_token")) return { ready: false, line: "Meta is not connected — Settings" };
      if (!n) return { ready: false, line: "No competitors listed yet — Settings" };
      return { ready: true, line: `${plural(n, "competitor")} followed · ${plural(saved, "post")} saved so far` };
    },
    run: () => viaAction("read_competitors", (o) => {
      const r = o as { saved?: number; already?: number; errors?: string[] };
      return {
        made: `${r.saved ?? 0} new`,
        detail: `${r.already ?? 0} already had${r.errors?.length ? ` · ${r.errors.length} account(s) did not answer` : ""}`,
        href: "/inspiration",
      };
    }),
  },
  {
    key: "draft_replies",
    kind: "run",
    label: "Draft the replies",
    what: "Writes a reply to each new comment in your voice — they wait for you to send",
    holds: () => {
      const waiting = one("SELECT COUNT(*) n FROM comments WHERE COALESCE(draft,'') = '' AND COALESCE(status,'') != 'done'");
      return waiting
        ? { ready: true, line: `${plural(waiting, "comment")} with no reply drafted` }
        : { ready: false, line: "Nothing waiting for a reply" };
    },
    run: () => viaAction("draft_replies", (o) => ({
      made: `${(o as { drafted?: number })?.drafted ?? 0} drafted`,
      detail: "Read every one before it goes — Circuit never sends them",
      href: "/listening",
    })),
  },
  {
    key: "check_website",
    kind: "run",
    label: "Read the site",
    what: "Reads the website again and says what changed — pages added, gone or edited",
    holds: () => {
      const site = getSetting("brand_site");
      if (!site) return { ready: false, line: "No website read yet" };
      try {
        const v = JSON.parse(site);
        return { ready: true, line: `${plural((v.pages || []).length, "page")} last read ${(v.crawled_at || "").slice(0, 10)}` };
      } catch { return { ready: true, line: "Ready" }; }
    },
    run: () => viaAction("check_website", (o) => {
      const r = o as { pages?: number; changes?: number; note?: string };
      return {
        made: r.note ? `${r.pages ?? 0} pages read` : `${r.changes ?? 0} changes`,
        detail: r.note || `across ${r.pages ?? 0} pages`,
        href: "/knowledge",
      };
    }),
  },
  {
    key: "look_at_posters",
    kind: "run",
    label: "Look at them",
    what: "Describes six more of your own posters, so the picture findings get better",
    holds: () => {
      const left = one("SELECT COUNT(*) n FROM own_posts WHERE file_id IS NOT NULL AND id NOT IN (SELECT own_post_id FROM poster_tags)");
      return left
        ? { ready: true, line: `${plural(left, "poster")} not looked at yet` }
        : { ready: false, line: "Every poster has been described" };
    },
    run: () => viaAction("look_at_posters", (o) => {
      const r = o as { described?: number; left?: number };
      return { made: `${r.described ?? 0} described`, detail: `${r.left ?? 0} still to look at`, href: "/analytics" };
    }),
  },

  /* ---- things Circuit opens, with what it holds for them ---- */
  {
    key: "poster_studio",
    kind: "open",
    label: "Open poster studio",
    what: "Where printed artwork is made from your own photographs",
    href: "/poster",
    holds: () => {
      const photos = one("SELECT COUNT(*) n FROM files WHERE kind = 'product'");
      const products = one("SELECT COUNT(*) n FROM products");
      if (!photos) return { ready: false, line: "No product photographs on file — that is the first thing needed" };
      return { ready: true, line: `${plural(products, "product")} · ${plural(photos, "photograph")} to work from` };
    },
  },
  {
    key: "creation_studio",
    kind: "open",
    label: "Open the studio",
    what: "Where a post's picture is made, from a reference and a product shot",
    href: "/creation",
    holds: () => {
      const refs = one("SELECT COUNT(*) n FROM inspirations");
      const photos = one("SELECT COUNT(*) n FROM files WHERE kind = 'product'");
      if (!photos) return { ready: false, line: "No product photographs on file" };
      return { ready: true, line: `${plural(refs, "reference")} saved · ${plural(photos, "product photo")}` };
    },
  },
  {
    key: "the_queue",
    kind: "open",
    label: "Open the queue",
    what: "Every planned post, how far along it is, and what it needs next",
    href: "/slots",
    holds: () => {
      const open = one("SELECT COUNT(*) n FROM slots WHERE status != 'posted'");
      return open
        ? { ready: true, line: `${plural(open, "post")} in hand` }
        : { ready: false, line: "Nothing planned yet — fill the month first" };
    },
  },
  {
    key: "library",
    kind: "open",
    label: "Open the library",
    what: "Every picture and video the brand owns, named and findable",
    href: "/library",
    holds: () => {
      const files = one("SELECT COUNT(*) n FROM files WHERE mime LIKE 'image/%' OR mime LIKE 'video/%'");
      const named = one("SELECT COUNT(*) n FROM files WHERE COALESCE(title,'') != ''");
      return { ready: files > 0, line: files ? `${plural(files, "file")} held · ${named} named` : "Nothing in the library yet" };
    },
  },
  {
    key: "drafts",
    kind: "open",
    label: "Open drafts",
    what: "Written pieces — blogs, emails, captions — kept where they can be edited",
    href: "/drafts",
    holds: () => {
      const n = one("SELECT COUNT(*) n FROM drafts");
      return { ready: true, line: n ? `${plural(n, "draft")} written` : "Nothing drafted yet" };
    },
  },
  {
    key: "calendar_links",
    kind: "open",
    label: "Open the calendar",
    what: "Where a post gets the tagged link that makes its visits traceable",
    href: "/calendar",
    holds: () => {
      const linked = one("SELECT COUNT(*) n FROM posts WHERE COALESCE(link_url,'') != ''");
      const posts = one("SELECT COUNT(*) n FROM posts");
      return { ready: posts > 0, line: posts ? `${linked} of ${posts} posts send people to the website` : "No posts yet" };
    },
  },
  {
    key: "knowledge",
    kind: "open",
    label: "Open what we know",
    what: "The facts Circuit will stand behind in anything it writes",
    href: "/knowledge",
    holds: () => {
      const live = one("SELECT COUNT(*) n FROM knowledge WHERE status = 'live'");
      return { ready: live > 0, line: live ? `${plural(live, "fact")} live` : "Nothing recorded yet — written work has nothing to lean on" };
    },
  },
];

const BY_KEY = new Map(DOORS.map((d) => [d.key, d]));

export const doorFor = (key: string): Door | undefined => BY_KEY.get(key);

export type DoorState = { key: string; kind: DoorKind; label: string; what: string; href?: string; ready: boolean; line: string };

/* The door as the page needs it: what it is, and what Circuit holds for it right now. */
export function doorState(key: string): DoorState | null {
  const d = BY_KEY.get(key);
  if (!d) return null;
  let holds: { ready: boolean; line: string };
  /* A readiness check that throws — a table that is not there on an older database — must not
     take the whole board down with it. */
  try { holds = d.holds(); } catch { holds = { ready: false, line: "Circuit could not check what it has for this" }; }
  return { key: d.key, kind: d.kind, label: d.label, what: d.what, href: d.href, ready: holds.ready, line: holds.line };
}

export const allDoors = (): DoorState[] => DOORS.map((d) => doorState(d.key)!).filter(Boolean);
