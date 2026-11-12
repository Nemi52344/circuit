"use client";
import { useCallback, useEffect, useState } from "react";

/* The look a poster or a carousel is printed in: NEMI on black, NEMI on bone white, or the
   original BNC. The choice is remembered in the browser, so the Image and Carousel tabs agree
   and the Studio opens the way it was left. */

export type Look = { id: string; name: string; what: string; ground: string; ink: string; accent: string; mark: string; mark_tail: string; site: string };

const KEY = "circuit-poster-look";

export function useLook(looks: Look[], fallback: string): [string, (id: string) => void] {
  const [look, setLook] = useState(fallback);
  useEffect(() => {
    if (!looks.length) return;
    let saved = "";
    try { saved = localStorage.getItem(KEY) || ""; } catch { /* a private window: the default will do */ }
    setLook(looks.some((l) => l.id === saved) ? saved : fallback);
  }, [looks, fallback]);
  const pick = useCallback((id: string) => {
    setLook(id);
    try { localStorage.setItem(KEY, id); } catch { /* not remembered, still applied */ }
  }, []);
  return [look, pick];
}

/* The ground with its accent beside it — enough to tell the three apart before reading a name. */
export function LookChip({ look }: { look: Look }) {
  return <i className="look-chip" style={{ background: look.ground }} aria-hidden="true"><em style={{ background: look.accent }} /></i>;
}

/* The wordmark in the top left and the address in the bottom left. Each look brings its own,
   shown here as the placeholder; anything typed replaces it on the poster. */
export type BrandLine = { mark: string; mark_tail: string; site: string };
export const NO_BRAND_LINE: BrandLine = { mark: "", mark_tail: "", site: "" };

export function BrandLineFields({ look, value, onChange, tailHint }: { look?: Look; value: BrandLine; onChange: (v: BrandLine) => void; tailHint?: string }) {
  const typed = [value.mark, value.mark_tail].filter(Boolean).join(" ");
  const shown = typed || [look?.mark, look?.mark_tail || tailHint].filter(Boolean).join(" ");
  return (
    <details className="brand-line">
      <summary>Wordmark and website <span className="muted">{shown}{shown ? " · " : ""}{value.site || look?.site} ›</span></summary>
      <div className="form-grid">
        <label className="field">
          <span className="eyebrow">Wordmark</span>
          <input className="input" value={value.mark} placeholder={look?.mark || "NEMI"} onChange={(e) => onChange({ ...value, mark: e.target.value })} />
        </label>
        <label className="field">
          <span className="eyebrow">Second word <em className="muted">in the accent</em></span>
          <input className="input" value={value.mark_tail} placeholder={look?.mark_tail || tailHint || ""} onChange={(e) => onChange({ ...value, mark_tail: e.target.value })} />
        </label>
        <label className="field full">
          <span className="eyebrow">Website <em className="muted">bottom left</em></span>
          <input className="input" value={value.site} placeholder={look?.site || ""} onChange={(e) => onChange({ ...value, site: e.target.value })} />
        </label>
      </div>
    </details>
  );
}
