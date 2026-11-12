/* The marketing work, line by line, and where each line lives in Circuit.

   These are the workstreams on the team's whiteboard, in its order, plus the image database
   added after it. Each says which
   page does it, how much of it runs without a person, and — where a person is still needed —
   the reason. The Learning tests read this to ask about the platform, and the deck reads it to
   count what is automated, so the two cannot disagree.

   `auto` is honest only if it is true of the running app: "full" means nobody has to start it,
   "partial" means Circuit does the work once somebody asks or supplies something, "manual"
   means Circuit only keeps the record. No imports, so a page and a test can both read it. */

export type Automation = "full" | "partial" | "manual";
export type Module = { n: number; name: string; page: string; auto: Automation; does: string; person: string };

export const MODULES: Module[] = [
  { n: 1, name: "Workflows", page: "/automation?tab=workflows", auto: "full",
    does: "Routines run on their own schedule: research, plan, draft, check, email the result.",
    person: "Somebody approves a step that waits for sign-off." },
  { n: 2, name: "Calendar", page: "/", auto: "full",
    does: "The month is laid out from the content pillars with a date and platform for every post; adding a post is one click.",
    person: "Moving a post to another day is a drag." },
  { n: 3, name: "Audit", page: "/automation", auto: "partial",
    does: "The website is checked and changes reported; every routine run is timed and its failures shown.",
    person: "Deciding what to fix on the site." },
  { n: 4, name: "Database", page: "/library", auto: "full",
    does: "Every post, file, claim, competitor post and number sits in one database that backs itself up.",
    person: "Nothing." },
  { n: 5, name: "Task manager", page: "/work", auto: "partial",
    does: "Every piece of marketing work has a purpose and a door: open it and Circuit starts the work it can do.",
    person: "The work Circuit cannot do — a shoot, a print proof — is done and ticked by a person." },
  { n: 6, name: "Dashboard", page: "/home", auto: "full",
    does: "Home shows what is due, what went out, the Instagram numbers and the most-viewed post.",
    person: "Nothing." },
  { n: 7, name: "Daily intel", page: "/intel", auto: "full",
    does: "Ten industry verticals swept every morning and a scored briefing emailed at 09:30 — Claude's if it has made one, Circuit's own sweep if not. It never waits to be asked.",
    person: "Nothing." },
  { n: 8, name: "Daily intel dashboard", page: "/intel", auto: "full",
    does: "Every briefing filed and readable, with competitors' new posts alongside.",
    person: "Nothing." },
  { n: 9, name: "Performance per post", page: "/reports", auto: "full",
    does: "Reach, likes, saves and comments pulled for each of our posts, and each format scored.",
    person: "Nothing for Instagram. LinkedIn and X give us no API access to their numbers." },
  { n: 10, name: "Work Gantt", page: "/work", auto: "full",
    does: "All the marketing work on one timeline. Content bars move with the calendar, jobs Circuit raised close themselves when resolved, and time Circuit spends is logged against the task.",
    person: "Marking something blocked, or work you added yourself." },
  { n: 11, name: "Stock count", page: "/money?tab=bills", auto: "full",
    does: "Each item entered once with its monthly use; Circuit works out what is left, the reorder date, and puts the reorder and the monthly count on the Work board itself.",
    person: "Entering an item, a delivery, or a real count once a month." },
  { n: 12, name: "Billing and payments", page: "/money?tab=bills", auto: "partial",
    does: "Bills filed against the vendor and the month; card statements read and split into charges.",
    person: "Paying the bill, and uploading it." },
  { n: 13, name: "Tools and payments", page: "/money?tab=bills", auto: "partial",
    does: "Every subscription found on the card statement and listed with what it costs a month.",
    person: "Cancelling or renewing a tool." },
  { n: 14, name: "Manpower and salary", page: "/money?tab=finance", auto: "full",
    does: "Each salary is entered once and carried into every month's manpower cost and P&L until the person leaves. Seen by the Admin alone.",
    person: "Adding a joiner, a leaver or a raise." },
  { n: 15, name: "Opex", page: "/money?tab=finance", auto: "full",
    does: "The monthly AI and automation bill — ChatGPT, Claude, Grok, Higgsfield, Zapier and the rest — counted from the bills every month, with no typing.",
    person: "Nothing for AI tools; a non-AI standing cost such as rent is entered once." },
  { n: 16, name: "P&L", page: "/money?tab=finance", auto: "partial",
    does: "Revenue less every cost, month on month, built from bills, tools, salaries and opex.",
    person: "Revenue is entered; the Admin alone sees it." },
  { n: 17, name: "API connections", page: "/automation", auto: "full",
    does: "Every connection — Meta, ChatGPT, Gemini, mail — listed with whether it is working right now.",
    person: "Renewing an expired key." },
  { n: 18, name: "Bot list", page: "/automation", auto: "full",
    does: "Every agent and skill in use, read from Claude and ChatGPT, with when it last ran.",
    person: "Nothing." },
  { n: 19, name: "Automation share", page: "/automation", auto: "full",
    does: "How much of the work runs by itself, counted from the work that was actually started.",
    person: "Nothing." },
  { n: 20, name: "Image database", page: "/images", auto: "manual",
    does: "The raw collateral — our own photographs and video from every shoot — kept apart from references and drafts so it can be trusted.",
    person: "Adding the files from the shoot — Circuit does not hold the camera." },
];

/* Full counts one, partial half, manual nothing. A rough measure, stated as one. */
export function automatedShare(list: Module[] = MODULES): number {
  const score = list.reduce((s, m) => s + (m.auto === "full" ? 1 : m.auto === "partial" ? 0.5 : 0), 0);
  return Math.round((score / list.length) * 100);
}
