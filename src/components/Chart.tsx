"use client";
import { useEffect, useId, useRef, useState } from "react";

/* Charts, drawn as SVG by hand.

   No library: these are a line and some bars over at most a few dozen points, and a charting
   dependency would be more code than the charts. Everything is sized in a viewBox and scaled by
   CSS, so it stays sharp at any width and needs no measuring of the container.

   Colour comes from the stylesheet's own variables rather than being passed in, so the charts
   follow the theme into dark mode without anybody remembering to update them. */

export type Point = {
  label: string;
  value: number;
  /* Shown under the readout when the point is hovered. */
  note?: string;
  /* A point built on too little to trust. Drawn hollow, and said so in the readout — the whole
     reason this exists is that a thin month and a solid one look identical once averaged. */
  thin?: boolean;
  /* No data at all here, as distinct from a measured zero. The line breaks across it. */
  empty?: boolean;
};

const PAD = { top: 16, right: 14, bottom: 26, left: 44 };

/* The chart draws at the width it is actually given, rather than drawing at a fixed width and
   being scaled down to fit.

   Scaling is what an SVG does by default and it is wrong here: on a phone a 760-wide viewBox
   squeezed into 310 pixels takes the 11px axis labels down to four, which is not small text, it
   is no text. Measuring instead means one pixel in the viewBox is one pixel on the glass, so the
   labels are 11px everywhere and only the chart gets narrower. */
function useWidth(fallback = 760) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const next = Math.round(e.contentRect.width);
      if (next > 0) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceTop = (max: number): number => {
  if (max <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (step * mag >= max) return step * mag;
  }
  return 10 * mag;
};

const short = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

export function LineChart({ points, unit = "", height = 190 }: { points: Point[]; unit?: string; height?: number }) {
  const [at, setAt] = useState<number | null>(null);
  const [box, W] = useWidth();
  const id = useId();
  if (points.length < 2) return <div ref={box} />;

  const top = niceTop(Math.max(...points.map((p) => p.value)));
  const innerW = Math.max(60, W - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  /* The line is broken into runs of months that actually have posts, so a gap in the account's
     history shows as a gap rather than a confident straight line across it. */
  const runs: { i: number; p: Point }[][] = [];
  let run: { i: number; p: Point }[] = [];
  points.forEach((p, i) => {
    if (p.empty) { if (run.length) runs.push(run); run = []; }
    else run.push({ i, p });
  });
  if (run.length) runs.push(run);

  const ticks = [0, 0.5, 1].map((f) => Math.round(top * f));
  /* Enough labels to orient, never so many they collide. */
  const shown = at !== null ? points[at] : null;

  /* A label every point is unreadable on a phone and sparse on a desktop, so how many are drawn
     follows the width the chart actually got. */
  const perLabel = 56;
  const labelEveryW = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / perLabel))));

  return (
    <div className="chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="img"
        aria-label={`${unit || "value"} over time, ${points.length} points, highest ${short(top)}`}
        onMouseLeave={() => setAt(null)}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="c-fill-top" />
            <stop offset="100%" className="c-fill-bottom" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line className="c-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="c-axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{short(t)}</text>
          </g>
        ))}

        {runs.map((r, ri) => (
          <g key={ri}>
            {r.length > 1 ? (
              <>
                <path className="c-area" fill={`url(#fill-${id})`}
                  d={`M ${x(r[0].i)} ${y(0)} ${r.map((q) => `L ${x(q.i)} ${y(q.p.value)}`).join(" ")} L ${x(r[r.length - 1].i)} ${y(0)} Z`} />
                <polyline className="c-line" points={r.map((q) => `${x(q.i)},${y(q.p.value)}`).join(" ")} />
              </>
            ) : null}
          </g>
        ))}

        {points.map((p, i) => p.empty ? null : (
          <circle key={i} className={`c-dot ${p.thin ? "thin" : ""} ${at === i ? "on" : ""}`} cx={x(i)} cy={y(p.value)} r={at === i ? 5 : 3.5} />
        ))}

        {/* One invisible column per point, so hovering anywhere above a month picks it up —
            aiming at a 3px dot is not a thing anybody should have to do. */}
        {points.map((p, i) => (
          <rect key={`h${i}`} x={x(i) - innerW / (points.length - 1) / 2} y={PAD.top}
            width={innerW / (points.length - 1)} height={innerH} fill="transparent"
            onMouseEnter={() => setAt(i)} />
        ))}

        {points.map((p, i) => (i % labelEveryW === 0 || i === points.length - 1
          ? <text key={`l${i}`} className="c-axis" x={x(i)} y={height - 8} textAnchor="middle">{p.label}</text>
          : null))}
      </svg>

      <div className={`c-read ${shown ? "on" : ""}`} aria-live="polite">
        {shown ? (
          <>
            <b>{shown.label}</b>
            <span>{shown.empty ? "nothing posted" : `${shown.value.toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`}</span>
            {shown.note ? <i>{shown.note}</i> : null}
            {shown.thin ? <i className="c-warn">too few posts to read much into</i> : null}
          </>
        ) : <span className="muted">Hover the line for a month</span>}
      </div>
    </div>
  );
}
