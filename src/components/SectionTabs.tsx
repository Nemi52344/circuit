"use client";
import { useCallback, useEffect, useState } from "react";

/* The tab strip on top of a section that holds several pages — Studio, Library. The tab is in
   the address (?tab=video), so a link or a redirect from an old page can open the right one,
   and Back goes back to the tab you were on. The page inside keeps its own heading; the
   section's big title is the strip's, so the inner one is quietened (see .section-tabs ~ *). */
type Tab = { key: string; label: string };

export function useTab(tabs: Tab[], fallback: string): [string, (k: string) => void] {
  const [tab, setTabState] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      setTabState(t && tabs.some((x) => x.key === t) ? t : fallback);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [tabs, fallback]);
  const setTab = useCallback((k: string) => {
    setTabState(k);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", k);
    window.history.pushState(null, "", u.toString());
  }, []);
  return [tab, setTab];
}

export function SectionTabs({ title, tabs, active, onPick }: { title: string; tabs: Tab[]; active: string; onPick: (k: string) => void }) {
  return (
    <div className="section-tabs">
      <h1>{title}</h1>
      <div className="wk"><div className="seg" role="tablist" aria-label={`${title} sections`}>
        {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={active === t.key ? "on" : ""} onClick={() => onPick(t.key)}>{t.label}</button>)}
      </div></div>
    </div>
  );
}
