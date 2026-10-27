import type { Can } from "@/lib/roles";

/* `needs` hides a page from anybody whose role lacks that grant. The API refuses them anyway;
   this is so a Marketing Executive is not shown a Finance tab that only ever says no. */
export type NavItem = { href: string; label: string; group: "Plan" | "Collect" | "Run" | "Manage"; icon: string; needs?: Can };
export const NAV: NavItem[] = [
  { href: "/home", label: "Home", group: "Plan", icon: "grid" },
  { href: "/", label: "Calendar", group: "Plan", icon: "calendar" },
  { href: "/slots", label: "All posts", group: "Plan", icon: "wall" },
  { href: "/posting", label: "Posting", group: "Plan", icon: "send" },
  { href: "/signoff", label: "Sign-off", group: "Plan", icon: "stamp", needs: "approve" },
  { href: "/poster", label: "Poster studio", group: "Plan", icon: "frame" },
  { href: "/workflows", label: "Workflows", group: "Plan", icon: "flow" },
  { href: "/inspiration", label: "Inspiration", group: "Collect", icon: "eye" },
  { href: "/intel", label: "Daily intel", group: "Plan", icon: "doc" },
  { href: "/listening", label: "Listening", group: "Collect", icon: "ear" },
  { href: "/comments", label: "Comments", group: "Collect", icon: "speech" },
  { href: "/knowledge", label: "What we know", group: "Collect", icon: "bulb" },
  { href: "/documents", label: "Brochures", group: "Collect", icon: "book" },
  { href: "/images", label: "Image database", group: "Collect", icon: "camera" },
  { href: "/library", label: "Library", group: "Collect", icon: "box" },
  { href: "/learning", label: "Learning", group: "Collect", icon: "cap" },
  { href: "/work", label: "Work", group: "Run", icon: "bars" },
  { href: "/admin", label: "Admin", group: "Run", icon: "ledger", needs: "manage" },
  /* What is plugged in and what runs by itself. Under Run rather than Manage: it answers an
     operational question — is anything broken — not a configuration one. */
  { href: "/automation", label: "Crons", group: "Run", icon: "clock", needs: "manage" },
  { href: "/finance", label: "Finance", group: "Run", icon: "rupee", needs: "finance" },
  { href: "/reports", label: "Reports", group: "Run", icon: "chart" },
  { href: "/build", label: "What to build", group: "Manage", icon: "hammer", needs: "manage" },
  { href: "/people", label: "People", group: "Manage", icon: "people", needs: "people" },
  { href: "/settings", label: "Settings", group: "Manage", icon: "gear", needs: "manage" },
];

export function activeNav(path: string): NavItem | undefined {
  // a single slot lives under Content slots
  if (path.startsWith("/slot/")) return NAV.find((it) => it.href === "/slots");
  return NAV.find((it) => (it.href === "/" ? path === "/" : path === it.href || path.startsWith(`${it.href}/`)));
}
