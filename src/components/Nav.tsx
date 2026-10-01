"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, activeNav } from "@/lib/nav";

const ICONS: Record<string, React.ReactNode> = {
  grid: <><rect x="1" y="1" width="6" height="6" /><rect x="9" y="1" width="6" height="6" /><rect x="1" y="9" width="6" height="6" /><rect x="9" y="9" width="6" height="6" /></>,
  calendar: <><rect x="1.5" y="3" width="13" height="11.5" /><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" /></>,
  chart: <><path d="M2 14h12" /><path d="M3.5 11l3-3.5 2.5 2 3.5-4.5" /></>,
  eye: <><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="2" /></>,
  spark: <><path d="M8 1.5l1.6 4.4L14 7.5l-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6z" /><path d="M13 12.5v2M12 13.5h2" /></>,
  wall: <><rect x="1.5" y="1.5" width="5.5" height="8" /><rect x="9" y="1.5" width="5.5" height="5" /><rect x="9" y="8.5" width="5.5" height="6" /><rect x="1.5" y="11.5" width="5.5" height="3" /></>,
  doc: <><path d="M3.5 1.5h6l3 3v10h-9z" /><path d="M9.5 1.5v3h3M5.5 8h5M5.5 11h5" /></>,
  box: <><path d="M8 1.5l6 3v7l-6 3-6-3v-7z" /><path d="M2 4.5l6 3 6-3M8 7.5v7" /></>,
  flow: <><rect x="1.5" y="1.5" width="5" height="4" /><rect x="9.5" y="6" width="5" height="4" /><rect x="1.5" y="10.5" width="5" height="4" /><path d="M6.5 3.5h3v2.5M9.5 10v2.5h-3" /></>,
  gear: <><circle cx="8" cy="8" r="2.6" /><path d="M8 1v2.4M8 12.6V15M15 8h-2.4M3.4 8H1M12.9 3.1l-1.7 1.7M4.8 11.2l-1.7 1.7M12.9 12.9l-1.7-1.7M4.8 4.8L3.1 3.1" /></>,
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
  // approvers opening a review link see the post only, not the workspace
  if (path?.startsWith("/review/")) return null;
  const active = activeNav(path);
  const groups = Array.from(new Set(NAV.map((i) => i.group)));
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Circuit</h1>
          <small>BNC Motors marketing</small>
        </div>
      </div>
      <nav className="nav" aria-label="Primary">
        {groups.map((g) => (
          <div key={g} style={{ display: "contents" }}>
            <div className="nav-section">{g}</div>
            {NAV.filter((it) => it.group === g).map((it) => (
              <Link key={it.href} href={it.href} className={active?.href === it.href ? "active" : ""} aria-current={active?.href === it.href ? "page" : undefined}>
                <Icon name={it.icon} />
                {it.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-note">
        <strong>Everything stays on this Mac</strong>
        Nothing is posted or sent without you.
      </div>
    </aside>
  );
}
