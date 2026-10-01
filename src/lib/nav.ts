export type NavItem = { href: string; label: string; group: "Plan" | "Collect" | "Run" | "Manage"; icon: string };
export const NAV: NavItem[] = [
  { href: "/home", label: "Home", group: "Plan", icon: "grid" },
  { href: "/", label: "Calendar", group: "Plan", icon: "calendar" },
  { href: "/slots", label: "All posts", group: "Plan", icon: "wall" },
  { href: "/posting", label: "Posting", group: "Plan", icon: "wall" },
  { href: "/workflows", label: "Workflows", group: "Plan", icon: "flow" },
  { href: "/inspiration", label: "Inspiration", group: "Collect", icon: "eye" },
  { href: "/intel", label: "Daily intel", group: "Plan", icon: "doc" },
  { href: "/listening", label: "Listening", group: "Collect", icon: "eye" },
  { href: "/knowledge", label: "What we know", group: "Collect", icon: "spark" },
  { href: "/documents", label: "Brochures", group: "Collect", icon: "doc" },
  { href: "/library", label: "Library", group: "Collect", icon: "box" },
  { href: "/work", label: "Work", group: "Run", icon: "flow" },
  { href: "/admin", label: "Admin", group: "Run", icon: "box" },
  { href: "/finance", label: "Finance", group: "Run", icon: "chart" },
  { href: "/reports", label: "Reports", group: "Run", icon: "grid" },
  { href: "/build", label: "What to build", group: "Manage", icon: "grid" },
  { href: "/settings", label: "Settings", group: "Manage", icon: "gear" },
];

export function activeNav(path: string): NavItem | undefined {
  // a single slot lives under Content slots
  if (path.startsWith("/slot/")) return NAV.find((it) => it.href === "/slots");
  return NAV.find((it) => (it.href === "/" ? path === "/" : path === it.href || path.startsWith(`${it.href}/`)));
}
