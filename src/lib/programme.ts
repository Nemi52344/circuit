import { listTasks, saveTask, type Task } from "@/lib/books";

/* Everything marketing actually produces, as a plan.

   The board already fills itself from what is in the database — this month's posts, what Circuit
   has flagged, its own build queue — and everything there is traceable to a record. This is the
   other thing: the list of what a brand like this one puts out. Brochures, standees, hoardings,
   reels, dealer kits, emails, stall designs. Work that ends in a thing somebody can hold, hang
   or post.

   It is a template and says so. Nothing here was read off anything; it is a starting list to cut
   down, not a report. The point of having it is the gaps — a board built only from what is
   already happening cannot tell you nobody has made a spec sheet, because not making one leaves
   no record to read.

   Durations are working estimates for a small team. Every one of them is meant to be edited. */

type Item = {
  disc: string;
  title: string;
  notes: string;
  week: number;      // weeks from the start
  weeks: number;     // how long it runs
  minutes: number;   // a working estimate, feeding the automation figure
  doable?: "app" | "person";
  after?: string;    // the title of the piece of work this follows
};

const PROGRAMME: Item[] = [
  /* ---- the printed things a showroom needs ---- */
  { disc: "Showroom print", title: "Product brochure", week: 0, weeks: 3, minutes: 1200, doable: "person",
    notes: "Eight to twelve pages, A4. The one thing a walk-in takes home. Photography, specifications, finance options and the dealer stamp panel on the back." },
  { disc: "Showroom print", title: "Single-page range leaflet", week: 2, weeks: 1, minutes: 300, doable: "person", after: "Product brochure",
    notes: "A4, both sides, cut down from the brochure. What gets handed out at traffic signals, melas and society events, where a twelve-page book is thrown away." },
  { disc: "Showroom print", title: "Technical specification sheet", week: 1, weeks: 1, minutes: 240, doable: "app",
    notes: "One page, every number: range, battery, charge time, motor, payload, warranty. The sheet a serious buyer and every fleet enquiry asks for." },
  { disc: "Showroom print", title: "Price list and EMI sheet", week: 1, weeks: 1, minutes: 180, doable: "app",
    notes: "On-road price by city, finance options, down payment and monthly figures. Reprinted whenever a price or a subsidy moves, so keep it to one page." },
  { disc: "Showroom print", title: "Showroom standee set", week: 2, weeks: 2, minutes: 600, doable: "person",
    notes: "Roll-up standees, about 6ft by 2.5ft. Three designs: the bike, the running-cost comparison, the finance offer. Read from eight feet away, so very few words." },
  { disc: "Showroom print", title: "Backdrop and wall graphic", week: 3, weeks: 2, minutes: 480, doable: "person",
    notes: "The wall behind the bikes, and the panel every delivery photograph is taken against. Worth getting right because it appears in customer photos for years." },
  { disc: "Showroom print", title: "Danglers, buntings and shelf talkers", week: 4, weeks: 1, minutes: 240, doable: "person",
    notes: "The small in-store pieces that carry an offer. Cheap, short-lived, and what makes a showroom look like something is happening." },
  { disc: "Showroom print", title: "Window and glass decals", week: 4, weeks: 1, minutes: 240, doable: "person",
    notes: "Frontage vinyl: logo, model name, the one line that stops somebody on the footpath." },
  { disc: "Showroom print", title: "Test-ride card and feedback slip", week: 3, weeks: 1, minutes: 180, doable: "app",
    notes: "What the rider fills in before and after. Doubles as the lead capture, so the fields on it decide what the follow-up can say." },
  { disc: "Showroom print", title: "Warranty and service booklet", week: 5, weeks: 2, minutes: 480, doable: "person",
    notes: "What is covered, for how long, and where to take it. Goes in the box; read at the worst possible moment, so it must be unambiguous." },
  { disc: "Showroom print", title: "Owner's manual", week: 6, weeks: 3, minutes: 960, doable: "person",
    notes: "Charging, care, monsoon handling, what the warning lights mean. In English and the local language of each main market." },

  /* ---- outdoor and the dealer network ---- */
  { disc: "Outdoor & dealer", title: "Dealer façade signage artwork", week: 2, weeks: 2, minutes: 480, doable: "person",
    notes: "The board above the shop, to a fixed template so forty dealers do not produce forty different brands." },
  { disc: "Outdoor & dealer", title: "Hoarding and billboard set", week: 4, weeks: 2, minutes: 600, doable: "person",
    notes: "Seen at speed from a distance: one image, under seven words, the logo and a dealer locator line." },
  { disc: "Outdoor & dealer", title: "Bus shelter and transit panels", week: 5, weeks: 2, minutes: 420, doable: "person",
    notes: "Read standing still, by somebody who is bored. The one outdoor format that can carry a running-cost comparison." },
  { disc: "Outdoor & dealer", title: "Wall painting artwork", week: 6, weeks: 2, minutes: 360, doable: "person",
    notes: "Semi-urban and highway walls, hand-painted from artwork. Flat colours and thick letterforms, because a painter copies it by eye." },
  { disc: "Outdoor & dealer", title: "Delivery and service vehicle wrap", week: 7, weeks: 2, minutes: 420, doable: "person",
    notes: "The company's own vehicles as moving signage. Pays for itself once and keeps going." },
  { disc: "Outdoor & dealer", title: "Dealer co-branded template pack", week: 6, weeks: 2, minutes: 480, doable: "app",
    notes: "Editable files where a dealer drops in their name, address and number and nothing else. Without it, every dealer makes their own and the brand stops looking like one." },

  /* ---- social media ---- */
  { disc: "Social", title: "Monthly content calendar", week: 0, weeks: 13, minutes: 480, doable: "app",
    notes: "A month planned ahead with pillars, formats and dates. Repeats monthly; Circuit plans and drafts most of it." },
  { disc: "Social", title: "Reel series — product features", week: 1, weeks: 4, minutes: 1200, doable: "person",
    notes: "One feature per reel, 15 to 30 seconds, shot vertically. Reels reach roughly two and a half times what a still does on this account." },
  { disc: "Social", title: "Reel series — rider stories", week: 3, weeks: 5, minutes: 1440, doable: "person",
    notes: "Real owners, their route, their reason, their running cost. The only content a competitor cannot copy." },
  { disc: "Social", title: "Carousel series — savings and EV education", week: 2, weeks: 4, minutes: 900, doable: "app",
    notes: "Petrol against electric, charging at home, battery myths, what a subsidy is actually worth. Carousels hold attention long enough to make an argument." },
  { disc: "Social", title: "Story template set", week: 2, weeks: 1, minutes: 300, doable: "app",
    notes: "Reusable frames for polls, questions, countdowns and behind-the-scenes, so daily stories take minutes rather than a design request." },
  { disc: "Social", title: "Festive campaign creatives", week: 5, weeks: 3, minutes: 900, doable: "person",
    notes: "Diwali, Pongal, Onam, New Year. Planned a month early, because every agency and dealer wants the same week." },
  { disc: "Social", title: "Launch campaign creatives", week: 7, weeks: 3, minutes: 1080, doable: "person",
    notes: "Teaser, reveal, specification drop, first rides, offer. One idea carried across every format rather than five unrelated posts." },
  { disc: "Social", title: "Comparison posts — petrol against electric", week: 4, weeks: 2, minutes: 480, doable: "app",
    notes: "The single most shared thing this category produces. Numbers must be defensible — an exaggerated saving comes straight back in the comments." },
  { disc: "Social", title: "Customer photo and repost templates", week: 5, weeks: 1, minutes: 240, doable: "app",
    notes: "A frame for reposting owner photos with permission. Free content, and the owner usually shares it onward." },
  { disc: "Social", title: "Reply and FAQ post set", week: 6, weeks: 2, minutes: 360, doable: "app",
    notes: "The eight questions asked in every comment thread, answered once properly and reused." },

  /* ---- digital and the website ---- */
  { disc: "Digital", title: "Website product page refresh", week: 3, weeks: 3, minutes: 900, doable: "person",
    notes: "Photography, specifications, finance and a booking button above the fold. Where every ad and every brochure QR code eventually lands." },
  { disc: "Digital", title: "Test-ride booking landing page", week: 5, weeks: 2, minutes: 600, doable: "person",
    notes: "One page, one ask, loads fast on a phone on mobile data. Sending paid traffic to the homepage wastes most of it." },
  { disc: "Digital", title: "Email template set", week: 6, weeks: 2, minutes: 480, doable: "app",
    notes: "Enquiry acknowledgement, test-ride confirmation, service reminder, festive offer. Written once, sent automatically." },
  { disc: "Digital", title: "WhatsApp broadcast creatives", week: 7, weeks: 2, minutes: 360, doable: "app",
    notes: "Square images and short text within the template rules. Only to numbers with recorded opt-in." },
  { disc: "Digital", title: "YouTube channel art and end cards", week: 8, weeks: 1, minutes: 240, doable: "person",
    notes: "Banner, thumbnails to a consistent style, and end cards pointing at the next video and the booking page." },
  { disc: "Digital", title: "Google Business photos and posts", week: 4, weeks: 2, minutes: 300, doable: "person",
    notes: "Showroom, team and product photographs per location. The first thing a local search shows, and usually the most neglected." },

  /* ---- what the sales floor needs ---- */
  { disc: "Sales kit", title: "Dealer sales kit", week: 4, weeks: 3, minutes: 720, doable: "person",
    notes: "Everything a salesperson needs in one folder: brochure, spec sheet, price list, finance options, comparison sheet." },
  { disc: "Sales kit", title: "Competitor comparison sheet", week: 5, weeks: 2, minutes: 480, doable: "app",
    notes: "Against Ola, Ather, TVS, Bajaj and Revolt on the figures buyers actually ask about. Honest, because a buyer will check on their phone while standing there." },
  { disc: "Sales kit", title: "Objection handling card", week: 6, weeks: 1, minutes: 300, doable: "person",
    notes: "Range anxiety, charging at home, battery life, resale, service network. One card, one answer each, in the salesperson's pocket." },
  { disc: "Sales kit", title: "Test-ride and demo script", week: 6, weeks: 1, minutes: 240, doable: "person",
    notes: "What to show, in what order, and what to say at each point. Turns an inconsistent demo into a repeatable one." },
  { disc: "Sales kit", title: "Fleet buyer proposal pack", week: 8, weeks: 3, minutes: 900, doable: "person",
    notes: "Total cost of ownership over three years, charging infrastructure, service terms, volume pricing. A different argument from the retail one." },

  /* ---- events ---- */
  { disc: "Events", title: "Expo and mela stall design", week: 7, weeks: 3, minutes: 960, doable: "person",
    notes: "Layout, panels, lighting and where the bikes stand. Designed so it works at two sizes, because the booked space changes." },
  { disc: "Events", title: "Roadshow and test-ride event kit", week: 8, weeks: 2, minutes: 600, doable: "person",
    notes: "Canopy, standees, flooring, the sign-up desk and the safety briefing card. Packed so one van carries it and two people set it up." },
  { disc: "Events", title: "Launch event collateral", week: 9, weeks: 3, minutes: 720, doable: "person",
    notes: "Invite, stage backdrop, press kit, photo wall, giveaway. Half of this exists so the photographs are usable afterwards." },
  { disc: "Events", title: "Dealer meet deck and materials", week: 10, weeks: 2, minutes: 600, doable: "person",
    notes: "Targets, new models, support on offer and what is expected back. The one meeting a year the whole network is in a room." },

  /* ---- identity ---- */
  { disc: "Identity", title: "Logo usage and brand pack", week: 0, weeks: 2, minutes: 600, doable: "person",
    notes: "Files in every format, clear space, minimum size, colour values, and what nobody is allowed to do to it. Sent to every printer and dealer." },
  { disc: "Identity", title: "Stationery — cards, letterhead, envelopes", week: 2, weeks: 1, minutes: 300, doable: "person", after: "Logo usage and brand pack",
    notes: "Visiting cards for the network, letterhead, invoice template and envelopes." },
  { disc: "Identity", title: "Staff uniform and merchandise", week: 6, weeks: 3, minutes: 480, doable: "person",
    notes: "Showroom and service shirts, caps, and the giveaway items worth actually keeping. Walking signage in the dealer's own town." },
  { disc: "Identity", title: "Packaging and delivery kit", week: 8, weeks: 3, minutes: 720, doable: "person",
    notes: "What the customer is handed at delivery: folder, keys, manual, charger bag. The last brand moment before they ride away and photograph it." },
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

  /* Written in order so a dependency is on the board before the thing that depends on it. */
  const ids = new Map<string, string>();

  for (const item of PROGRAMME) {
    const title = `${item.disc} — ${item.title}`;
    const key = title.trim().toLowerCase();
    if (have.has(key)) {
      skipped += 1;
      ids.set(item.title, have.get(key)!.id);
      continue;
    }
    const from = new Date(start.getTime() + item.week * 7 * 86400000);
    const to = new Date(from.getTime() + (item.weeks * 7 - 1) * 86400000);
    const saved: Task = saveTask({
      title,
      notes: `${item.notes}\n\nFrom the standard list of marketing work — edit or remove it if this is not something you make.`,
      owner: "",
      area: "marketing",
      start_date: iso(from),
      end_date: iso(to),
      status: "planned",
      progress: 0,
      depends_on: item.after ? ids.get(item.after) || null : null,
      estimate_minutes: item.minutes,
      /* Marked up front, which is what makes the automation figure mean anything: without a
         judgement on each piece of work, every hour reads as unavoidable. */
      doable_by: item.doable || "",
    });
    ids.set(item.title, saved.id);
    added.push(title);
  }

  return { added: added.length, skipped, titles: added };
}
