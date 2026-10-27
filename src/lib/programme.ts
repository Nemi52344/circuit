import { listTasks, saveTask, type Task } from "@/lib/books";

/* The marketing work Circuit can actually help with.

   An earlier version of this listed everything a brand puts out — forty-six things including
   staff uniforms, wall paintings and stall design. It was honest about the breadth of marketing
   and useless as a board, because forty of those rows were a name, two dates and no way to act:
   something to tick, not something to do. A board of rows nobody can act on is a board nobody
   opens, and the estimates on it then feed figures nobody should trust.

   So this is cut to the work that has a door — something Circuit runs now, or a screen that
   does it with what Circuit already holds. The things it cannot help with are not pretended
   into tasks. They are still marketing; they are just not Circuit's.

   Every item names its door, and the board reads what Circuit holds for it live. */

type Item = {
  disc: string;
  title: string;
  notes: string;
  week: number;      // weeks from the start
  weeks: number;     // how long it runs
  minutes: number;   // a working estimate
  doable: "app" | "person";
  door: string;      // see lib/doors.ts
};

const PROGRAMME: Item[] = [
  /* ---- the month's posts ---- */
  { disc: "Posts", title: "Plan this month's posts", week: 0, weeks: 1, minutes: 60, doable: "app", door: "fill_month",
    notes: "Dates, platforms and a pillar for each. Circuit lays the month out from your pillars and you cut it down." },
  { disc: "Posts", title: "Give every planned post a topic", week: 0, weeks: 2, minutes: 120, doable: "app", door: "topic_ideas",
    notes: "A post with a date and no topic is a reminder, not a plan. Circuit asks ChatGPT for one per empty slot." },
  { disc: "Posts", title: "Take each post from topic to finished picture", week: 1, weeks: 11, minutes: 1800, doable: "person", door: "the_queue",
    notes: "The queue carries each post through research, copy and picture, and says what it needs next and who does it." },
  { disc: "Posts", title: "Reels — the format that reaches furthest", week: 1, weeks: 11, minutes: 1200, doable: "person", door: "creation_studio",
    notes: "On this account a reel reaches about two and a half times what a still does, and none have gone out since September." },

  /* ---- printed and outdoor work ---- */
  { disc: "Print", title: "Posters, standees and showroom artwork", week: 1, weeks: 6, minutes: 900, doable: "person", door: "poster_studio",
    notes: "Made in the poster studio from your own product photography, to one template so forty dealers do not produce forty brands." },
  { disc: "Print", title: "Hoardings and outdoor artwork", week: 4, weeks: 4, minutes: 600, doable: "person", door: "poster_studio",
    notes: "Read at speed from a distance: one image, under seven words. Same studio, different shape." },

  /* ---- written work ---- */
  { disc: "Written", title: "Competitor comparison sheet", week: 2, weeks: 2, minutes: 300, doable: "app", door: "knowledge",
    notes: "Against the competitors Circuit follows, on the figures buyers ask about. It can only be as good as what is in What We Know — a buyer will check on their phone while standing there." },
  { disc: "Written", title: "Blog and long-form pieces", week: 2, weeks: 10, minutes: 720, doable: "person", door: "drafts",
    notes: "Slower than social and the only thing that still earns search traffic a year later." },
  { disc: "Written", title: "Email templates", week: 5, weeks: 2, minutes: 360, doable: "person", door: "drafts",
    notes: "Enquiry acknowledgement, test-ride confirmation, service reminder. Written once, sent many times." },
  { disc: "Written", title: "Record what we are allowed to claim", week: 0, weeks: 3, minutes: 300, doable: "person", door: "knowledge",
    notes: "Range, charge time, savings, warranty. Everything Circuit writes leans on this, and it will not invent a number that is not here." },

  /* ---- listening and replying ---- */
  { disc: "Listening", title: "Reply to comments and questions", week: 0, weeks: 12, minutes: 300, doable: "app", door: "draft_replies",
    notes: "Circuit drafts a reply in your voice to every new comment. Nothing is sent without you reading it." },
  { disc: "Listening", title: "Watch what competitors are publishing", week: 0, weeks: 12, minutes: 180, doable: "app", door: "read_competitors",
    notes: "Saved to Inspiration as it goes out, which is where the next creation starts from." },

  /* ---- the website ---- */
  { disc: "Website", title: "Keep the product page current", week: 2, weeks: 4, minutes: 600, doable: "app", door: "check_website",
    notes: "Circuit reads the site and says what changed — pages added, gone or edited — so the page nobody owns does not quietly rot." },
  { disc: "Website", title: "Tag the links campaigns send people to", week: 3, weeks: 2, minutes: 180, doable: "app", door: "calendar_links",
    notes: "A tagged link is what makes a visit traceable back to the post that earned it. Circuit builds the tag; the clicks need your analytics." },

  /* ---- the library and learning ---- */
  { disc: "Library", title: "Name and tag the brand's pictures", week: 1, weeks: 4, minutes: 480, doable: "person", door: "library",
    notes: "An asset nobody can find gets shot again at full price." },
  { disc: "Library", title: "Learn what works from our own posters", week: 2, weeks: 6, minutes: 240, doable: "app", door: "look_at_posters",
    notes: "Circuit describes each poster and compares the descriptions against what the posts actually did." },
];

export const PROGRAMME_SIZE = PROGRAMME.length;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Planted = { added: number; skipped: number; titles: string[] };

/* Puts the list on the board, starting from a date.

   Anything already on the board with the same name is left alone, so this can be run twice, and
   so a task somebody has already edited is never overwritten by the template it came from. */
export function plantProgramme(startDate?: string): Planted {
  const start = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
  start.setHours(0, 0, 0, 0);

  const have = new Map(listTasks().map((t) => [t.title.trim().toLowerCase(), t]));
  const added: string[] = [];
  let skipped = 0;

  for (const item of PROGRAMME) {
    const title = `${item.disc} — ${item.title}`;
    const key = title.trim().toLowerCase();
    if (have.has(key)) {
      skipped += 1;
      continue;
    }
    const from = new Date(start.getTime() + item.week * 7 * 86400000);
    const to = new Date(from.getTime() + (item.weeks * 7 - 1) * 86400000);
    const saved: Task = saveTask({
      title,
      notes: `${item.notes}\n\nFrom the standard list — edit or remove it if this is not how you work.`,
      owner: "",
      area: "marketing",
      start_date: iso(from),
      end_date: iso(to),
      status: "planned",
      progress: 0,
      depends_on: null,
      estimate_minutes: item.minutes,
      /* Marked up front, which is what makes the automation figure mean anything: without a
         judgement on each piece of work, every hour reads as unavoidable. */
      doable_by: item.doable,
      door: item.door,
    });
    added.push(title);
  }

  return { added: added.length, skipped, titles: added };
}
