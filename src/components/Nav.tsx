"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { activeNav, menuFor, type NavItem } from "@/lib/nav";
import { useMe } from "@/components/Gate";
import { can } from "@/lib/roles";

/* One glyph per place, and no two the same.

   Twenty-three links were sharing eight icons — four pages wore the same four squares — which
   made the rail a column of near-identical marks that had to be read word by word. An icon that
   does not distinguish is worse than no icon: it costs the space and gives nothing back. */
const ICONS: Record<string, React.ReactNode> = {
  grid: <><rect x="1" y="1" width="6" height="6" /><rect x="9" y="1" width="6" height="6" /><rect x="1" y="9" width="6" height="6" /><rect x="9" y="9" width="6" height="6" /></>,
  calendar: <><rect x="1.5" y="3" width="13" height="11.5" /><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" /></>,
  chart: <><path d="M2 14h12" /><path d="M3.5 11l3-3.5 2.5 2 3.5-4.5" /></>,
  eye: <><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="2" /></>,
  spark: <><path d="M8 1.5l1.6 4.4L14 7.5l-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6z" /></>,
  wall: <><rect x="1.5" y="1.5" width="5.5" height="8" /><rect x="9" y="1.5" width="5.5" height="5" /><rect x="9" y="8.5" width="5.5" height="6" /><rect x="1.5" y="11.5" width="5.5" height="3" /></>,
  doc: <><path d="M3.5 1.5h6l3 3v10h-9z" /><path d="M9.5 1.5v3h3M5.5 8h5M5.5 11h5" /></>,
  box: <><path d="M8 1.5l6 3v7l-6 3-6-3v-7z" /><path d="M2 4.5l6 3 6-3M8 7.5v7" /></>,
  flow: <><rect x="1.5" y="1.5" width="5" height="4" /><rect x="9.5" y="6" width="5" height="4" /><rect x="1.5" y="10.5" width="5" height="4" /><path d="M6.5 3.5h3v2.5M9.5 10v2.5h-3" /></>,
  gear: <><circle cx="8" cy="8" r="2.6" /><path d="M8 1v2.4M8 12.6V15M15 8h-2.4M3.4 8H1M12.9 3.1l-1.7 1.7M4.8 11.2l-1.7 1.7M12.9 12.9l-1.7-1.7M4.8 4.8L3.1 3.1" /></>,

  /* send — Posting: something leaving. */
  send: <><path d="M14.5 1.5L7 9" /><path d="M14.5 1.5L10 14.5 7 9 1.5 6z" /></>,
  /* stamp — Sign-off: a tick inside a seal. */
  stamp: <><circle cx="8" cy="8" r="6.5" /><path d="M5 8.2l2.1 2.1L11 6.4" /></>,
  /* frame — Poster studio: a canvas with a corner mark. */
  frame: <><rect x="1.5" y="2.5" width="13" height="11" /><path d="M1.5 10.5l3.5-3 3 2.5 2.5-2 4 3.5" /><circle cx="5.5" cy="6" r="1.1" /></>,
  /* ear — Listening. */
  ear: <><path d="M5 6a3 3 0 1 1 6 0c0 2-2 2.4-2 4.2A2 2 0 0 1 7 12" /><path d="M8 14.5A6.5 6.5 0 1 1 8 1.5" /></>,
  /* bulb — What we know. */
  bulb: <><path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2V12h5.2V9.7A4.5 4.5 0 0 0 8 1.5z" /><path d="M6.4 14h3.2" /></>,
  /* book — Brochures. */
  book: <><path d="M2 2.5h4.5A1.5 1.5 0 0 1 8 4v10a1.5 1.5 0 0 0-1.5-1.5H2z" /><path d="M14 2.5H9.5A1.5 1.5 0 0 0 8 4v10a1.5 1.5 0 0 1 1.5-1.5H14z" /></>,
  /* bars — Work, a chart of bars at different offsets. */
  bars: <><path d="M2 3.5h7M4.5 8h8M2 12.5h5.5" /></>,
  inbox: <><path d="M2 9.5 3.8 3h8.4L14 9.5V13H2z" /><path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" /></>,
  /* ledger — Admin. */
  ledger: <><rect x="2.5" y="1.5" width="11" height="13" /><path d="M5.5 5h5M5.5 8h5M5.5 11h3" /></>,
  /* clock — Crons: the thing that runs on a schedule. */
  clock: <><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.8" /></>,
  /* rupee — Finance, in the currency this company actually uses. */
  rupee: <><path d="M4.5 2h7M4.5 5.5h7M10.5 2c0 2.2-1.6 3.5-4 3.5h-2l6 9" /></>,
  /* hammer — What to build. */
  hammer: <><path d="M9.5 2.5l4 4-2 2-4-4z" /><path d="M7.5 4.5L2 10v4h4l5.5-5.5" /></>,
  /* speech — Comments: a reply under somebody else's post. */
  /* camera — Image database: the raw shots. */
  camera: <><path d="M1.5 5h3l1.2-2h4.6l1.2 2h3v8h-13z" /><circle cx="8" cy="8.8" r="2.4" /></>,
  /* cap — Learning: a mortarboard. */
  cap: <><path d="M1 6l7-3.5L15 6 8 9.5z" /><path d="M4 7.6V11c0 1 1.8 2 4 2s4-1 4-2V7.6" /><path d="M15 6v4" /></>,
  speech: <><path d="M14 9.5a2 2 0 0 1-2 2H5.5L2.5 14V4a2 2 0 0 1 2-2H12a2 2 0 0 1 2 2z" /><path d="M5.5 5.5h5M5.5 8h3" /></>,
  /* people — People. */
  people: <><circle cx="6" cy="5" r="2.5" /><path d="M1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" /><path d="M11 3.2a2.5 2.5 0 0 1 0 4.6M12 10.4c1.6.5 2.5 1.8 2.5 3.6" /></>,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();
  const { me } = useMe();
  const nav = useRef<HTMLElement>(null);
  /* On a phone the menu folds behind one button, so the page starts at the top of the screen
     instead of under a strip of links cut off at both edges. Closed again on every move. */
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);

  /* On a phone the rail is one horizontal strip holding nineteen links, so the page you are on
     is usually off to the right of what you can see. Without this you land on a nav that looks
     like it is showing you the start of the app rather than where you actually are. Harmless on
     a desktop, where the strip is a column and nothing overflows. */
  useEffect(() => {
    /* Twice: once after a frame, and again when the web font has landed.
       Running it during this render scrolls a strip whose links are still at fallback-font
       widths — the measurement is taken, Space Grotesk arrives, every link changes width and
       the strip ends up back near the start. Which of the two does the work depends on whether
       the font was already cached, so both are needed and neither is enough. */
    let gone = false;
    const show = () => {
      if (!gone) nav.current?.querySelector("a.active")?.scrollIntoView({ inline: "center", block: "nearest" });
    };
    const f = requestAnimationFrame(show);
    document.fonts?.ready.then(show).catch(() => {});
    return () => { gone = true; cancelAnimationFrame(f); };
  }, [path]);
  // approvers opening a review link see the post only, not the workspace
  if (path?.startsWith("/review/")) return null;
  const active = activeNav(path);
  const { main, more } = menuFor((c) => can(me, c));
  const groups = Array.from(new Set(main.map((i) => i.group)));
  const link = (it: NavItem) => (
    <Link key={it.href} href={it.href} className={active?.href === it.href ? "active" : ""} aria-current={active?.href === it.href ? "page" : undefined}>
      <Icon name={it.icon} />
      {it.label}
    </Link>
  );
  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="brand">
        <div className="brand-mark" aria-hidden="true" />
        <div>
          <strong className="brand-name">Circuit</strong>
          <small>BNC Motors marketing</small>
        </div>
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="primary-nav" onClick={() => setOpen((o) => !o)}>
          <span className="nav-here">{active?.label || "Menu"}</span>
          <span aria-hidden="true" className="nav-burger" />
          <span className="sr-only">{open ? "Close the menu" : "Open the menu"}</span>
        </button>
      </div>
      <nav className="nav" id="primary-nav" aria-label="Primary" ref={nav}>
        {groups.map((g) => (
          <div key={g} style={{ display: "contents" }}>
            <div className="nav-section">{g}</div>
            {main.filter((it) => it.group === g).map(link)}
          </div>
        ))}
        {more.length ? (
          /* Open by itself when the page you are on lives in here, so you can see where you are. */
          <details className="nav-more" open={more.some((it) => it.href === active?.href) || undefined}>
            <summary className="nav-section">More</summary>
            {more.map(link)}
          </details>
        ) : null}
      </nav>
      <div className="side-note">
        <strong>Runs on the marketing Mac</strong>
        Everything is in its database, copied online every minute. Nothing is posted or sent without you.
      </div>
    </aside>
  );
}
