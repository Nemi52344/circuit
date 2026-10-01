/* A turning half-world.

   Drawn rather than animated frame by frame: a sphere is a circle with latitude
   rings that never move and meridians that do. A meridian seen edge-on is a line
   and seen face-on is a circle, so sweeping each one's horizontal radius from
   full width to nothing and back — each starting at a different point in that
   sweep — reads as a globe turning, because that is geometrically what is
   happening. No library, no canvas, no images.

   The markers sit at real places the group works from. They drift with the
   meridians so they look attached to the surface rather than painted on glass. */

const R = 300;
const LATS = [-230, -165, -92, 0, 92, 165, 230];
const MERIDIANS = 9;

/* Where the dots sit: a fraction across the sphere (-1 left, 1 right) and down. */
const PLACES = [
  { x: -0.18, y: -0.30, label: "Coimbatore" },
  { x: 0.34, y: -0.08, label: "Chennai" },
  { x: -0.52, y: 0.14, label: "Pune" },
  { x: 0.12, y: 0.38, label: "Bengaluru" },
  { x: 0.58, y: 0.46, label: "Singapore" },
  { x: -0.72, y: -0.46, label: "Delhi" },
];

export function Globe({ className = "" }: { className?: string }) {
  return (
    <svg className={`globe ${className}`} viewBox={`0 0 ${R * 2} ${R * 2}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="g-face" cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#2A3330" />
          <stop offset="58%" stopColor="#141A18" />
          <stop offset="100%" stopColor="#070B0A" />
        </radialGradient>
        <radialGradient id="g-glow" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="rgba(201,242,76,0)" />
          <stop offset="100%" stopColor="rgba(201,242,76,.35)" />
        </radialGradient>
        <clipPath id="g-clip"><circle cx={R} cy={R} r={R - 2} /></clipPath>
      </defs>

      <circle cx={R} cy={R} r={R - 2} fill="url(#g-face)" />

      <g clipPath="url(#g-clip)" className="globe-wire">
        {/* latitudes: fixed, because turning a sphere does not move them */}
        {LATS.map((off) => {
          const ry = 9 + Math.abs(off) * 0.055;
          const rx = Math.sqrt(Math.max((R - 2) ** 2 - off ** 2, 1));
          return <ellipse key={off} cx={R} cy={R + off} rx={rx} ry={ry} />;
        })}
        {/* meridians: each sweeps its own width, a step apart, and the whole set
            reads as one rotation */}
        {Array.from({ length: MERIDIANS }, (_, i) => (
          <ellipse key={i} className="globe-mer" cx={R} cy={R} rx={R - 2} ry={R - 2}
            style={{ animationDelay: `${(-i * 18) / MERIDIANS}s` }} />
        ))}
      </g>

      <g clipPath="url(#g-clip)" className="globe-dots">
        {PLACES.map((p, i) => (
          <g key={p.label} style={{ animationDelay: `${(-i * 18) / PLACES.length}s` }}>
            <circle cx={R + p.x * (R - 40)} cy={R + p.y * (R - 40)} r="5.5" className="globe-dot" />
            <circle cx={R + p.x * (R - 40)} cy={R + p.y * (R - 40)} r="5.5" className="globe-ping" />
          </g>
        ))}
      </g>

      <circle cx={R} cy={R} r={R - 2} fill="url(#g-glow)" />
      <circle cx={R} cy={R} r={R - 2} className="globe-rim" />
    </svg>
  );
}
