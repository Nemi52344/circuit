"use client";
import { useEffect, useMemo, useState } from "react";
import { api, postJson, fileUrl } from "@/lib/api";
import { useToast } from "@/components/ui";
import { ScheduleBox } from "@/components/ScheduleBox";
import { useLook, LookChip, BrandLineFields, NO_BRAND_LINE, type Look } from "@/components/PosterLook";

/* The Carousel tab of the Studio: a whole set at once. A cover that asks the question, then
   one slide per point — a figure or a claim, with where it comes from. Every slide previews
   live, side by side, in the order it will be swiped; "Make the carousel" prints them all,
   numbered, and the set can go straight onto the calendar as one post. */

type Photo = { id: string; name: string };
type Point = { number: string; unit: string; headline: string; source: string };
type Size = { w: number; h: number; label: string };

const BLANK_POINT: Point = { number: "", unit: "", headline: "", source: "" };
const MAX = 9;

function SlidePreview({ spec, size, scale }: { spec: Record<string, unknown>; size: Size; scale: number }) {
  const [html, setHtml] = useState("");
  const key = JSON.stringify(spec);
  useEffect(() => {
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/poster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...spec, preview: true }) });
        if (!dead && r.ok) setHtml(await r.text());
      } catch { /* the preview may lag */ }
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cr-frame" style={{ width: size.w * scale, height: size.h * scale }}>
      <iframe title="Slide preview" srcDoc={html} tabIndex={-1} style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, pointerEvents: "none" }} />
    </div>
  );
}

export function CarouselStudio() {
  const { push, view } = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [size, setSize] = useState<"post" | "square">("post");
  const [cover, setCover] = useState({ headline: "", eyebrow: "", photo_file_id: "", prompt: "Swipe →" });
  const [points, setPoints] = useState<Point[]>([{ ...BLANK_POINT }, { ...BLANK_POINT }, { ...BLANK_POINT }]);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ files: { file_id: string; name: string }[]; title: string } | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [fallback, setFallback] = useState("");
  const [look, pickLook] = useLook(looks, fallback);
  const [brand, setBrand] = useState(NO_BRAND_LINE);

  useEffect(() => {
    api<{ photos: Photo[]; sizes: Record<string, Size>; themes: Look[]; default_theme: string }>("/api/poster")
      .then((r) => { setPhotos(r.photos); setSizes(r.sizes); setLooks(r.themes); setFallback(r.default_theme); })
      .catch((e: Error) => push(e.message, "bad"));
  }, [push]);

  const filled = points.filter((p) => p.headline.trim() || p.number.trim());
  const total = filled.length + 1;
  /* The look and the brand line are the same on every slide of a set. */
  const common = useMemo(() => ({ theme: look || undefined, ...brand }), [look, brand]);
  const specs = useMemo(() => [
    { ...common, template: "cover", size, headline: cover.headline || "Your question goes here", eyebrow: cover.eyebrow, photo_file_id: cover.photo_file_id || null, prompt: cover.prompt, counter: `1 / ${total}` },
    ...points.map((p, i) => ({ ...common, template: "point", size, number: p.number, unit: p.unit, headline: p.headline || (p.number ? "" : `Point ${i + 1}`), source: p.source, counter: `${i + 2} / ${total}` })),
  ], [common, size, cover, points, total]);

  const setPoint = (i: number, k: keyof Point, v: string) => { setPoints((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p))); setMade(null); };
  const move = (i: number, d: -1 | 1) => setPoints((ps) => { const n = [...ps]; const j = i + d; if (j < 0 || j >= n.length) return ps; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const make = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ files: { file_id: string; name: string }[]; title: string }>("/api/poster/carousel", { size, ...common, cover, points: filled });
      setMade(r);
      push(`${r.files.length} slides made and saved to the library`, "ok");
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  const sz = sizes[size] || { w: 1080, h: 1350, label: "" };
  const scale = 190 / sz.w;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {view}
      <section className="cr-strip" aria-label="The carousel, in swipe order">
        {specs.map((spec, i) => (
          <div key={i} className={`cr-slide ${i > 0 && !(points[i - 1].headline.trim() || points[i - 1].number.trim()) ? "is-empty" : ""}`}>
            <SlidePreview spec={spec} size={sz} scale={scale} />
            <span className="cr-n">{i === 0 ? "Cover" : `Slide ${i + 1}`}</span>
          </div>
        ))}
      </section>

      <section className="vs-grid">
        <div className="vs-opts">
          <strong>Cover</strong>
          <label className="field"><span>The question or promise <em>what makes people swipe</em></span>
            <input className="input" value={cover.headline} onChange={(e) => { setCover({ ...cover, headline: e.target.value }); setMade(null); }} placeholder="e.g. S110 or S125 — which one fits your day?" /></label>
          <div className="wk-drawer-grid">
            <label className="field"><span>Small line above <em>optional</em></span><input className="input" value={cover.eyebrow} onChange={(e) => setCover({ ...cover, eyebrow: e.target.value })} placeholder="e.g. Buyer's guide" /></label>
            <label className="field"><span>Swipe prompt</span><input className="input" value={cover.prompt} onChange={(e) => setCover({ ...cover, prompt: e.target.value })} /></label>
          </div>
          <label className="field"><span>Photograph <em>our own photography only</em></span>
            <select className="input" value={cover.photo_file_id} onChange={(e) => setCover({ ...cover, photo_file_id: e.target.value })}>
              <option value="">No photograph</option>
              {photos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="small muted">Look</span>
            <div className="wk"><div className="seg small">
              {looks.map((t) => <button key={t.id} type="button" aria-pressed={look === t.id} className={look === t.id ? "on" : ""} onClick={() => { pickLook(t.id); setMade(null); }}><LookChip look={t} />{t.name}</button>)}
            </div></div>
          </div>
          <BrandLineFields look={looks.find((l) => l.id === look)} tailHint={look === "bnc" ? "Challenger" : ""} value={brand} onChange={(v) => { setBrand(v); setMade(null); }} />
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="small muted">Shape</span>
            <div className="wk"><div className="seg small">
              {(["post", "square"] as const).map((k) => <button key={k} type="button" className={size === k ? "on" : ""} onClick={() => setSize(k)}>{k === "post" ? "Portrait 4:5" : "Square 1:1"}</button>)}
            </div></div>
          </div>
        </div>

        <div className="vs-opts">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>Slides</strong>
            <button type="button" className="btn small" disabled={points.length >= MAX} onClick={() => setPoints([...points, { ...BLANK_POINT }])}>+ Add a slide</button>
          </div>
          {points.map((p, i) => (
            <div key={i} className="cr-point">
              <div className="row" style={{ alignItems: "center", gap: 6 }}>
                <b className="small">Slide {i + 2}</b>
                <span style={{ marginLeft: "auto" }} />
                <button type="button" className="btn small ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn small ghost" aria-label="Move down" disabled={i === points.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn small ghost" aria-label="Remove" disabled={points.length <= 1} onClick={() => setPoints(points.filter((_, j) => j !== i))}>×</button>
              </div>
              <div className="cr-point-grid">
                <input className="input" value={p.number} onChange={(e) => setPoint(i, "number", e.target.value)} placeholder="Figure — e.g. 120" aria-label={`Slide ${i + 2} figure`} />
                <input className="input" value={p.unit} onChange={(e) => setPoint(i, "unit", e.target.value)} placeholder="Unit — e.g. km" aria-label={`Slide ${i + 2} unit`} />
                <input className="input wide" value={p.headline} onChange={(e) => setPoint(i, "headline", e.target.value)} placeholder="The claim — e.g. certified range on one charge" aria-label={`Slide ${i + 2} claim`} />
                <input className="input wide" value={p.source} onChange={(e) => setPoint(i, "source", e.target.value)} placeholder="Where it comes from — e.g. ARAI certificate" aria-label={`Slide ${i + 2} source`} />
              </div>
            </div>
          ))}
          <button type="button" className="btn primary" disabled={busy} onClick={make}>{busy ? `Printing ${total} slides…` : `Make the ${total}-slide carousel`}</button>
          <p className="small muted" style={{ margin: 0 }}>Every word is one you typed — the template cannot invent a figure. Empty slides are left out.</p>
        </div>
      </section>

      {made ? (
        <section className="vs-opts">
          <strong>Made — {made.files.length} slides</strong>
          <div className="cr-made">{made.files.map((f) => <a key={f.file_id} href={fileUrl(f.file_id)} target="_blank" rel="noreferrer"><img src={fileUrl(f.file_id)} alt={f.name} /></a>)}</div>
          <ScheduleBox fileIds={made.files.map((f) => f.file_id)} title={made.title} push={push} />
        </section>
      ) : null}
    </div>
  );
}
