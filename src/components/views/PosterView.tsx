"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, postJson, fileUrl } from "@/lib/api";
import { ScheduleBox } from "@/components/ScheduleBox";
import { useToast } from "@/components/ui";
import { useLook, LookChip, BrandLineFields, type Look } from "@/components/PosterLook";

/* The poster studio.

   Circuit's other way of making a picture sends a prompt to an image model and waits. This one
   sets type over a photograph the brand already owns, and prints it. No credits, no queue, and
   the same input always gives the same poster.

   The preview is the real template rendered in an iframe, not a mock-up of it — so what is on
   screen is what comes out of Chrome, and the two cannot drift apart. */

type Template = { id: string; group: string; name: string; what: string; needs: string[] };
type Size = { w: number; h: number; label: string };
type Photo = { id: string; name: string };
type Made = { file_id: string; creation_id: string | null; name: string; width: number; height: number };

type Spec = {
  template: string; size: string;
  eyebrow: string; number: string; unit: string; superscript: string;
  headline: string; facts: string[]; photo_file_id: string;
  mark: string; mark_tail: string; site: string;
  footnote: string; source: string;
  name: string; role: string; place: string; counter: string; prompt: string;
};

const BLANK: Spec = {
  template: "load", size: "post",
  /* No superscript by default: on an empty form it drew a lone "+" floating where the number
     is not yet, which looks like a rendering fault rather than an empty field. */
  eyebrow: "", number: "", unit: "", superscript: "",
  headline: "", facts: ["", "", ""], photo_file_id: "",
  mark: "", mark_tail: "", site: "",
  footnote: "Built in Coimbatore\nMade in India", source: "",
  name: "", role: "", place: "", counter: "", prompt: "",
};

/* `groups` narrows the templates — the Studio's Image tab leaves the carousel slides to the
   Carousel tab, which makes the whole set at once. */
export default function PosterPage({ groups = ["Product", "Carousel", "Crew"] }: { groups?: string[] }) {
  const [opts, setOpts] = useState<{ templates: Template[]; sizes: Record<string, Size>; themes: Look[]; default_theme: string; photos: Photo[] } | null>(null);
  const [s, setS] = useState<Spec>(BLANK);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const { push, view } = useToast();

  useEffect(() => { api<typeof opts>("/api/poster").then(setOpts).catch((e: Error) => push(e.message, "bad")); }, [push]);

  const set = <K extends keyof Spec>(k: K, v: Spec[K]) => { setS((x) => ({ ...x, [k]: v })); setMade(null); };
  const looks = useMemo(() => opts?.themes || [], [opts]);
  const [look, pickLook] = useLook(looks, opts?.default_theme || "");
  const theLook = looks.find((l) => l.id === look);

  /* The preview posts the spec and renders the HTML that comes back. A GET with the fields in
     the query string would be simpler and would break the first time a caption contained an
     ampersand. */
  const [preview, setPreview] = useState("");
  const specKey = JSON.stringify([s, look]);
  useEffect(() => {
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/poster", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...s, theme: look || undefined, facts: s.facts.filter(Boolean), preview: true }),
        });
        const html = r.ok ? await r.text() : "";
        if (!dead) setPreview(html);
      } catch { /* the preview is allowed to lag; the render is what matters */ }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [specKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const size = opts?.sizes[s.size];
  /* Fills the preview column rather than a fixed 440px, so the poster is big enough to judge
     type on. Never above 1 — scaling a 1080px render up would show you something softer than
     what gets printed. */
  /* The preview is the centre of the page, so it is as big as the centre column and the window
     allow — never above 1, since scaling a 1080px render up shows something softer than what
     gets printed. */
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 520, h: 640 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    /* The stage's own width less its padding; the height is what the window has left once the
       section title above and the button bar below are counted, so poster and button are both
       on screen at once. */
    const measure = () => setRoom({ w: Math.max(200, el.clientWidth - 36), h: Math.max(320, window.innerHeight - Math.max(76, el.getBoundingClientRect().top) - 150) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [opts]);
  const scale = useMemo(() => (size ? Math.min(1, room.w / size.w, room.h / size.h) : 0.45), [size, room]);

  const make = async () => {
    setBusy(true);
    try {
      const r = await postJson<Made>("/api/poster", { ...s, theme: look || undefined, facts: s.facts.filter(Boolean) });
      setMade(r);
      push("Made, and it is in the library", "ok");
    } catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  if (!opts) return <p className="muted">Loading…</p>;
  const tpl = opts.templates.find((t) => t.id === s.template);
  const isCrew = tpl?.group === "Crew";

  return (
    <div className="stack">
      {view}
      {groups.includes("Carousel") ? (
        <div className="page-head">
          <div>
            <h2>Poster studio</h2>
            <p className="lede">
              Type set over the brand&rsquo;s own photography and printed by Chrome. No image model, so nothing is
              invented and nothing is charged — every word on the poster is one you typed.
            </p>
          </div>
        </div>
      ) : null}

      {/* The poster in the middle; what to make on the left, what it says on the right, and the
          button to print it right under it. */}
      <div className="ps3">
        <aside className="ps3-left panel">
          <div className="eyebrow tpl-eyebrow">Look</div>
          <div className="tpl-set look-set">
            <div className="tpl-col">
              {looks.map((t) => (
                <button key={t.id} type="button" aria-pressed={look === t.id}
                  className={`tpl ${look === t.id ? "on" : ""}`}
                  onClick={() => { pickLook(t.id); setMade(null); }}>
                  <b><LookChip look={t} />{t.name}</b><span>{t.what}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="eyebrow tpl-eyebrow">Template</div>
            {groups.map((g) => (
              <div key={g} className="tpl-set">
                <div className="tpl-group">{g}</div>
                <div className="tpl-col">
                  {opts.templates.filter((t) => t.group === g).map((t) => (
                    <button key={t.id} type="button"
                      className={`tpl ${s.template === t.id ? "on" : ""}`}
                      onClick={() => set("template", t.id)}>
                      <b>{t.name}</b><span>{t.what}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </aside>

        <section className="ps3-center">
          <div className="ps3-stage" ref={stage}>
            <div className="poster-frame ps3-frame" style={{ width: size ? size.w * scale : 520, height: size ? size.h * scale : 640, background: theLook?.ground }}>
              <iframe title="Poster preview" srcDoc={preview}
                style={{ width: size?.w, height: size?.h, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }} />
            </div>
          </div>
          <div className="ps3-bar">
            <span className="small muted ps3-note">{tpl ? <b>{tpl.name}</b> : null}{theLook ? ` · ${theLook.name}` : ""}{size ? ` · ${size.w}×${size.h}` : ""} · live preview of exactly what gets printed — every word is one you typed</span>
            <span className="actions">
              <button className="btn ghost" type="button" onClick={() => { setS(BLANK); setMade(null); }}>Clear</button>
              <button className="btn primary" type="button" disabled={busy} onClick={make}>{busy ? "Printing…" : "Make it"}</button>
            </span>
          </div>
          <div className="ps3-made">
          {tpl ? <p className="small muted" style={{ margin: 0 }}>Needs: {tpl.needs.join(", ")}.</p> : null}

          {made ? (
            <div className="note small">
              <b>{made.name}</b> · {made.width}×{made.height} — saved to the library
              {made.creation_id ? " and attached to the slot" : ""}.
              <div style={{ marginTop: 8 }}>
                <a className="btn small" href={fileUrl(made.file_id)} download={made.name}>Save the picture</a>
              </div>
            </div>
          ) : null}
          {made ? <ScheduleBox key={made.file_id} fileIds={[made.file_id]} title={made.name} push={push} /> : null}
          </div>
        </section>

        <aside className="ps3-right panel stack">
          <div className="eyebrow">What it says</div>
          <label className="field">
            <span className="eyebrow">Size</span>
            <select className="select" value={s.size} onChange={(e) => set("size", e.target.value)}>
              {Object.entries(opts.sizes).map(([k, v]) => <option key={k} value={k}>{v.label} · {v.w}×{v.h}</option>)}
            </select>
          </label>

          <label className="field">
            <span className="eyebrow">Eyebrow <em className="muted">the small line above</em></span>
            <input className="input" value={s.eyebrow} placeholder="Exoskeletal chassis"
              onChange={(e) => set("eyebrow", e.target.value)} />
          </label>

          {s.template !== "statement" ? (
            <div className="form-grid">
              <label className="field">
                <span className="eyebrow">Number</span>
                <input className="input" value={s.number} placeholder="200" onChange={(e) => set("number", e.target.value)} />
              </label>
              <label className="field">
                <span className="eyebrow">Unit</span>
                <input className="input" value={s.unit} placeholder="kg" onChange={(e) => set("unit", e.target.value)} />
              </label>
              <label className="field">
                <span className="eyebrow">After the number <em className="muted">optional</em></span>
                <input className="input" value={s.superscript} placeholder="+"
                  onChange={(e) => set("superscript", e.target.value)} />
              </label>
            </div>
          ) : null}

          <label className="field">
            <span className="eyebrow">{s.template === "load" ? "The line under it" : "Headline"}</span>
            <textarea className="textarea" rows={2} value={s.headline}
              placeholder={s.template === "load" ? "of load. On an electric two-wheeler." : "The question nobody asks out loud."}
              onChange={(e) => set("headline", e.target.value)} />
          </label>

          {isCrew ? (
            <div className="form-grid">
              <label className="field">
                <span className="eyebrow">Name</span>
                <input className="input" value={s.name} placeholder="Ramya Subramanian"
                  onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="field">
                <span className="eyebrow">Role</span>
                <input className="input" value={s.role} placeholder="Production engineer"
                  onChange={(e) => set("role", e.target.value)} />
              </label>
              <label className="field full">
                <span className="eyebrow">Place</span>
                <input className="input" value={s.place} placeholder="Coimbatore · full time"
                  onChange={(e) => set("place", e.target.value)} />
              </label>
            </div>
          ) : null}

          {s.template === "cover" || s.template === "point" ? (
            <div className="form-grid">
              <label className="field">
                <span className="eyebrow">Slide counter</span>
                <input className="input" value={s.counter} placeholder="1 / 5"
                  onChange={(e) => set("counter", e.target.value)} />
              </label>
              <label className="field">
                <span className="eyebrow">Swipe prompt</span>
                <input className="input" value={s.prompt} placeholder="Swipe — four answers"
                  onChange={(e) => set("prompt", e.target.value)} />
              </label>
            </div>
          ) : null}

          <label className="field">
            <span className="eyebrow">{isCrew && (s.template === "welcome" || s.template === "milestone") ? "Their photograph" : "Photograph"}</span>
            <select className="select" value={s.photo_file_id} onChange={(e) => set("photo_file_id", e.target.value)}>
              <option value="">None</option>
              {opts.photos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="small muted">
              Only pictures marked as the brand&rsquo;s own.
              {s.template === "welcome" || s.template === "milestone"
                ? ` Cropped to ${look === "bnc" ? "a circle" : "a square with one corner cut"}, so a head-and-shoulders shot works best.`
                : ""}
            </span>
          </label>

          <div className="field">
            <span className="eyebrow">Facts along the bottom <em className="muted">fact | where it comes from</em></span>
            {s.facts.map((f, i) => (
              <input key={i} className="input" value={f} style={{ marginTop: i ? 6 : 0 }}
                aria-label={`Fact ${i + 1} along the bottom`}
                placeholder={["Double cradle frame | High-tensile steel", "Rain, hills, rough road | Rugged to the core", "Built in-house | Designed in India"][i]}
                onChange={(e) => { const next = [...s.facts]; next[i] = e.target.value; set("facts", next); }} />
            ))}
          </div>

          <label className="field">
            <span className="eyebrow">Bottom right</span>
            <input className="input" value={s.source} placeholder="Challenger S110 · S125"
              onChange={(e) => set("source", e.target.value)} />
          </label>

          <label className="field">
            <span className="eyebrow">{s.template === "hiring" || s.template === "cover" ? "Line under the headline" : "Top right"}</span>
            <textarea className="textarea" rows={2} value={s.footnote} placeholder={"Built in Coimbatore\nMade in India"}
              onChange={(e) => set("footnote", e.target.value)} />
          </label>

          <BrandLineFields look={theLook} tailHint={look === "bnc" ? (isCrew ? "Motors" : "Challenger") : ""}
            value={{ mark: s.mark, mark_tail: s.mark_tail, site: s.site }}
            onChange={(v) => { setS((x) => ({ ...x, ...v })); setMade(null); }} />

        </aside>
      </div>
    </div>
  );
}
