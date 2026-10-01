/* Platform marks.

   On a calendar day the word "Instagram" is six times wider than the thing it
   identifies and competes with the post title next to it. A mark is read without
   being read, which is the whole point of a glyph.

   Monochrome and inheriting colour, so they sit in whatever the surrounding text
   is doing rather than dragging five brand colours onto a quiet page. Each one
   still carries its name for a screen reader and on hover, because an icon alone
   is not a label. */

const MARKS: Record<string, { d: string; stroke?: boolean; extra?: React.ReactNode }> = {
  Instagram: {
    d: "M7.6 3h8.8A4.6 4.6 0 0 1 21 7.6v8.8a4.6 4.6 0 0 1-4.6 4.6H7.6A4.6 4.6 0 0 1 3 16.4V7.6A4.6 4.6 0 0 1 7.6 3Z",
    stroke: true,
    extra: (
      <>
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="17.1" cy="6.9" r="1.25" fill="currentColor" stroke="none" />
      </>
    ),
  },
  Facebook: {
    d: "M13.6 21v-8.2h2.75l.41-3.19H13.6V7.57c0-.92.26-1.55 1.58-1.55h1.69V3.17c-.29-.04-1.3-.13-2.47-.13-2.44 0-4.12 1.49-4.12 4.23v2.34H7.52v3.19h2.76V21h3.32Z",
  },
  LinkedIn: {
    d: "M5.06 3.5a2.06 2.06 0 1 1 0 4.12 2.06 2.06 0 0 1 0-4.12ZM3.3 9.2h3.52V21H3.3V9.2Zm6.1 0h3.37v1.62h.05c.47-.88 1.61-1.8 3.32-1.8 3.55 0 4.21 2.27 4.21 5.22V21h-3.52v-5.12c0-1.22-.02-2.8-1.72-2.8-1.72 0-1.99 1.33-1.99 2.71V21H9.4V9.2Z",
  },
  X: {
    d: "M17.47 3h3.1l-6.78 7.78L21.75 21h-6.24l-4.89-6.4L4.93 21H1.82l7.25-8.29L1.5 3h6.4l4.42 5.85L17.47 3Zm-1.09 16.14h1.72L7.03 4.77H5.19l11.19 14.37Z",
  },
  Blog: {
    d: "M6.5 3h7L19 8.5V21H6.5V3Z",
    stroke: true,
    extra: (
      <>
        <path d="M13.5 3v5.5H19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M9.5 13h6M9.5 16.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
};

export function PlatformMark({ name, size = 15 }: { name: string; size?: number }) {
  const m = MARKS[name];
  /* A platform Circuit has no mark for still has to appear, so it falls back to
     its first letter rather than vanishing from the day. */
  if (!m) {
    return (
      <span className="pmark" title={name} aria-label={name} role="img">
        <b>{name.slice(0, 2)}</b>
      </span>
    );
  }
  return (
    <span className="pmark" title={name} aria-label={name} role="img">
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
        <path d={m.d} fill={m.stroke ? "none" : "currentColor"} stroke={m.stroke ? "currentColor" : "none"}
          strokeWidth={m.stroke ? 1.7 : undefined} strokeLinejoin={m.stroke ? "round" : undefined} />
        {m.extra}
      </svg>
    </span>
  );
}

/* A row of them, de-duplicated and in a settled order so the same day does not
   shuffle its marks about between renders. */
const ORDER = ["Instagram", "Facebook", "X", "LinkedIn", "Blog"];
export function PlatformMarks({ names, size }: { names: string[]; size?: number }) {
  const seen = Array.from(new Set(names.filter(Boolean)));
  seen.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return <span className="pmarks">{seen.map((p) => <PlatformMark key={p} name={p} size={size} />)}</span>;
}
