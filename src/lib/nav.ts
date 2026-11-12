import type { Can } from "@/lib/roles";

/* Two different things decide what a person sees in the menu.

   `needs` is permission: without that grant the page is hidden and the API refuses anyway, so
   a Marketing Executive is not shown a Finance tab that only ever says no.

   `main` and `more` are attention. The menu is short on purpose — the things this person
   does every day, and nothing else. A page whose `main` grant they lack, or that is marked
   `more`, still exists for them: it sits folded under More at the bottom, one click away,
   instead of crowding out the work. */
export type NavGroup = "Today" | "Content" | "Know" | "Run";
export type NavItem = { href: string; label: string; group: NavGroup; icon: string; needs?: Can; main?: Can; more?: boolean };
export const NAV: NavItem[] = [
  { href: "/home", label: "Home", group: "Today", icon: "grid" },
  { href: "/work", label: "Work", group: "Today", icon: "bars" },
  /* Comments on other people's posts, as a daily habit — out from under More. */
  { href: "/engage", label: "Engager", group: "Today", icon: "speech" },
  { href: "/", label: "Calendar", group: "Content", icon: "calendar" },
  { href: "/content", label: "Content status", group: "Content", icon: "stamp" },
  { href: "/studio", label: "Studio", group: "Content", icon: "frame" },
  { href: "/library", label: "Library", group: "Content", icon: "box" },
  { href: "/intel", label: "Daily intel", group: "Know", icon: "doc" },
  { href: "/learning", label: "Learning", group: "Know", icon: "cap" },
  { href: "/reports", label: "Reports", group: "Know", icon: "chart", main: "manage" },
  /* Running the team, three pages with tabs: the money (costs, the P&L, bills and stock), what
     runs by itself (health, routines), and the settings. The team itself — who does what, who
     can sign in — lives on the Work page, where the work is given out. */
  { href: "/money", label: "Money", group: "Run", icon: "rupee", needs: "manage" },
  { href: "/automation", label: "Automation", group: "Run", icon: "flow", needs: "manage" },
  { href: "/settings", label: "Settings", group: "Run", icon: "gear", needs: "manage" },
  /* Kept, working, and rarely the reason anybody opens Circuit. */
  { href: "/slots", label: "All posts", group: "Content", icon: "wall", more: true },
  { href: "/listening", label: "Listening", group: "Know", icon: "ear", more: true },
  { href: "/knowledge", label: "What we know", group: "Know", icon: "bulb", more: true },
  { href: "/build", label: "What to build", group: "Run", icon: "hammer", needs: "manage", more: true },
];

/* What one person's menu holds: the short list, and what folds under More. */
export function menuFor(allowed: (c: Can) => boolean): { main: NavItem[]; more: NavItem[] } {
  const mine = NAV.filter((it) => !it.needs || allowed(it.needs));
  const isMain = (it: NavItem) => !it.more && (!it.main || allowed(it.main));
  return { main: mine.filter(isMain), more: mine.filter((it) => !isMain(it)) };
}

export function activeNav(path: string): NavItem | undefined {
  // a single slot lives under Content slots
  if (path.startsWith("/slot/")) return NAV.find((it) => it.href === "/slots");
  return NAV.find((it) => (it.href === "/" ? path === "/" : path === it.href || path.startsWith(`${it.href}/`)));
}
