"use client";
import { useState } from "react";
import { money, change } from "@/lib/money";

/* The small pieces the business pages are made of.

   Work, Admin, Finance and Reports are all the same shape underneath — a row of headline
   numbers, a table you can type into, and a way to add a row. Keeping that shape in one place
   is what stops four pages drifting into four different-looking pages. */

export function Kpi({ label, value, hint, tone = "" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <strong>{value}</strong>
      <small>{label}</small>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/* Which way a number moved since last month. Nothing is called good or bad here: costs going up
   alongside revenue is not a problem, and the page has no business deciding that it is. */
export function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  const d = change(now, before);
  if (d === null) return <span className="delta flat">—</span>;
  if (d === 0) return <span className="delta flat">no change</span>;
  const good = invert ? d < 0 : d > 0;
  return <span className={`delta ${good ? "up" : "down"}`}>{d > 0 ? "↑" : "↓"} {Math.abs(d)}%</span>;
}

export function Tabs({ tabs, active, onPick }: {
  tabs: { key: string; label: string; count?: number }[];
  active: string; onPick: (k: string) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} type="button" className={t.key === active ? "on" : ""} onClick={() => onPick(t.key)}>
          {t.label}{t.count !== undefined ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* A cell you can type straight into. Saving happens when you leave the box or press Enter, so
   there is no Save button to forget and no half-typed number written to the database. */
export function Cell({ value, onSave, type = "text", placeholder = "", align = "", options, width }: {
  value: string | number; onSave: (v: string) => void; type?: string; placeholder?: string;
  align?: string; options?: readonly string[]; width?: number;
}) {
  const [v, setV] = useState(String(value ?? ""));
  const [editing, setEditing] = useState(false);
  const commit = () => { setEditing(false); if (v !== String(value ?? "")) onSave(v); };

  if (options) {
    return (
      <select className="input" style={{ minHeight: 30, padding: "0 6px", fontSize: 13 }} value={String(value ?? "")}
        onChange={(e) => onSave(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      className="input"
      style={{ minHeight: 30, padding: "0 7px", fontSize: 13, textAlign: align === "num" ? "right" : "left", width: width ? `${width}px` : "100%" }}
      type={type} placeholder={placeholder}
      value={editing ? v : String(value ?? "")}
      onFocus={() => { setV(String(value ?? "")); setEditing(true); }}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(String(value ?? "")); setEditing(false); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/* Money in, money out. Typed in rupees because that is how people say it; stored in paise. */
export function MoneyCell({ paise, onSave }: { paise: number; onSave: (rupees: string) => void }) {
  return <Cell value={paise ? (paise / 100).toString() : ""} onSave={onSave} type="number" align="num" placeholder="0" />;
}

export const Money = ({ paise }: { paise: number }) => <>{money(paise)}</>;

export function Rows<T>({ rows, empty, children }: { rows: T[]; empty: React.ReactNode; children: React.ReactNode }) {
  return rows.length ? <div className="table-wrap"><table className="data">{children}</table></div> : <>{empty}</>;
}
