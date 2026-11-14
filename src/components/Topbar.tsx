"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { activeNav } from "@/lib/nav";
import { api, postJson } from "@/lib/api";
import { ROLES, asRole, can } from "@/lib/roles";
import { useMe, SignOutButton } from "@/components/Gate";
import { Bell } from "@/components/Bell";

type Brand = { id: string; slug: string; name: string };

/* Which brand's books you are looking at.

   Switching reloads rather than re-fetching, and deliberately so: every screen in the app is
   holding data from the brand that was in front a moment ago, and a half-swapped workspace —
   this brand's calendar beside that brand's spend — is the exact confusion this feature
   exists to prevent. A reload is a second, and it is unambiguous. */
function BrandSwitcher() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [active, setActive] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ brands: Brand[]; active: string }>("/api/brands")
      .then((r) => { setBrands(r.brands); setActive(r.active); })
      .catch(() => { /* the door is shut, or there is nothing to switch between yet */ });
  }, []);
  useEffect(() => { load(); }, [load]);

  /* One brand is not a choice, so it is not shown as one. */
  if (brands.length < 2) return null;

  const switchTo = async (slug: string) => {
    if (slug === active || busy) return;
    setBusy(true);
    try { await postJson("/api/brands", { slug }, "PATCH"); window.location.reload(); }
    catch { setBusy(false); }
  };

  return (
    <select
      className="brand-switch"
      aria-label="Which brand you are working on"
      value={active}
      disabled={busy}
      onChange={(e) => switchTo(e.target.value)}
    >
      {brands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
    </select>
  );
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("nemi-theme", next);
  } catch {
    // storage unavailable; the attribute still applies for this page
  }
}

export default function Topbar() {
  const { me } = useMe();
  const path = usePathname();
  // approvers opening a review link see the post only, not the workspace
  if (path?.startsWith("/review/")) return null;
  const item = activeNav(path);
  return (
    <header className="topbar">
      <div className="tb-crumb">
        <b>{item ? item.label : "Circuit"}</b>
      </div>
      <div className="tb-right">
        {/* Switching changes the brand for everyone on this computer, so it is a manager's call. */}
        {can(me, "manage") ? <BrandSwitcher /> : null}
        <div className="branch-pill" title="Primary product">
          <span className="dot" />
          Challenger 110 · v1.0
        </div>
        {me ? <Bell /> : null}
        <button className="tb-btn" type="button" title="Toggle light / dark" aria-label="Toggle light or dark theme" onClick={toggleTheme}>
          <svg className="ic-moon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M13.5 9.6A5.6 5.6 0 116.4 2.5a4.9 4.9 0 007.1 7.1z" />
          </svg>
          <svg className="ic-sun" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" />
          </svg>
        </button>
        {/* Who is actually signed in, rather than a name baked into the page. The role is here
            because it decides whether the Sign-off buttons appear, and a person who cannot
            approve should be able to see why without hunting for it. */}
        {me ? (
          <div className="user-chip" title={me.email}>
            <div className="avatar">{(me.name || me.email).slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <div className="un">{me.name}</div>
              <div className="ur">{ROLES.find((r) => r.role === asRole(me.role))?.label || "Viewer"}</div>
            </div>
            <SignOutButton />
          </div>
        ) : null}
      </div>
    </header>
  );
}
