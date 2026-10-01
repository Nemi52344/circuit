"use client";
import { usePathname } from "next/navigation";
import { activeNav } from "@/lib/nav";

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
        <div className="branch-pill" title="Primary product">
          <span className="dot" />
          Challenger 110 · v1.0
        </div>
        <button className="tb-btn" type="button" title="Toggle light / dark" aria-label="Toggle light or dark theme" onClick={toggleTheme}>
          <svg className="ic-moon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M13.5 9.6A5.6 5.6 0 116.4 2.5a4.9 4.9 0 007.1 7.1z" />
          </svg>
          <svg className="ic-sun" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" />
          </svg>
        </button>
        <div className="user-chip" title="Product owner">
          <div className="avatar">P</div>
          <div className="user-meta">
            <div className="un">Prashanth</div>
            <div className="ur">Marketing</div>
          </div>
        </div>
      </div>
    </header>
  );
}
