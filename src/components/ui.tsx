"use client";
import { useCallback, useEffect, useState } from "react";

export function Pill({ tone = "", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: string }[]>([]);
  const push = useCallback((text: string, tone = "") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const view = (
    <div className="toast-region" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
  return { push, view };
}

export function statusTone(status: string) {
  switch (status) {
    case "approved":
    case "posted":
    case "verified":
    case "saved":
      return "ok";
    case "scheduled":
    case "generated":
      return "info";
    case "failed":
    case "blocked":
      return "bad";
    case "draft":
    default:
      return "";
  }
}

export function Modal({ title, eyebrow = "", onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-rule" />
        <div className="modal-head">
          <div>
            {eyebrow ? <div className="m-eyebrow">{eyebrow}</div> : null}
            <h3>{title}</h3>
          </div>
          <button className="x-btn" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* One picture, opened big wherever pictures are listed: the image itself, what it is,
   its details and whatever you can do with it. Arrow keys and the ‹ › buttons move
   through the rest of the list, Escape closes. */
export type ViewerItem = {
  id: string;
  src: string;
  title: string;
  subtitle?: string;
  tags?: { label: string; tone?: string }[];
  fields?: { label: string; value: string }[];
  body?: string;
  links?: { label: string; url: string }[];
  actions?: React.ReactNode;
};

export function ImageViewer({ items, index, onIndex, onClose, eyebrow = "" }: {
  items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; eyebrow?: string;
}) {
  const n = items.length;
  const at = Math.min(Math.max(index, 0), Math.max(0, n - 1));
  const it: ViewerItem | undefined = items[at];
  const [src, setSrc] = useState(it?.src || "");
  useEffect(() => setSrc(it?.src || ""), [it?.src]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && n > 1) onIndex((at - 1 + n) % n);
      else if (e.key === "ArrowRight" && n > 1) onIndex((at + 1) % n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, n, onIndex, onClose]);
  if (!it) return null;
  const head = [eyebrow, n > 1 ? `${at + 1} of ${n}` : ""].filter(Boolean).join(" · ");
  return (
    <Modal title={it.title || "Picture"} eyebrow={head} onClose={onClose}>
      <div className="pic-view">
        <div className="pic-view-img">
          {src ? (
            <img src={src} alt={it.title} referrerPolicy="no-referrer" onError={() => { if (!src.startsWith("/api/")) setSrc(`/api/inspiration/preview?url=${encodeURIComponent(it.src)}`); }} />
          ) : (
            <span className="small muted">No picture for this one</span>
          )}
          {n > 1 ? (
            <>
              <button className="pic-nav prev" type="button" aria-label="Previous" onClick={() => onIndex((at - 1 + n) % n)}>‹</button>
              <button className="pic-nav next" type="button" aria-label="Next" onClick={() => onIndex((at + 1) % n)}>›</button>
            </>
          ) : null}
        </div>
        <div className="stack">
          {it.tags?.length || it.subtitle ? (
            <div className="actions">
              {(it.tags || []).map((t) => <Pill key={t.label} tone={t.tone || ""}>{t.label}</Pill>)}
              {it.subtitle ? <span className="small muted">{it.subtitle}</span> : null}
            </div>
          ) : null}
          {it.fields?.length ? (
            <dl className="pic-fields">
              {it.fields.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
            </dl>
          ) : null}
          {it.body ? <div className="pic-caption">{it.body}</div> : null}
          <div className="actions">
            {it.actions}
            {(it.links || []).map((l) => <a key={l.url} className="btn small ghost" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}
            {it.src ? <a className="btn small ghost" href={it.src} target="_blank" rel="noreferrer">Full size ↗</a> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* An <img> that opens in the viewer when you click it. Pass `items` to let the arrows
   walk the rest of the set it belongs to. */
export function ViewableImage({ item, items, eyebrow = "", className = "", style, alt }: {
  item: ViewerItem; items?: ViewerItem[]; eyebrow?: string; className?: string; style?: React.CSSProperties; alt?: string;
}) {
  const list = items?.length ? items : [item];
  const [at, setAt] = useState<number | null>(null);
  return (
    <>
      <img
        className={className}
        style={{ cursor: "zoom-in", ...(style || {}) }}
        src={item.src}
        alt={alt ?? item.title}
        title="Open it here"
        onClick={() => setAt(Math.max(0, list.findIndex((x) => x.id === item.id)))}
      />
      {at !== null ? <ImageViewer items={list} index={at} onIndex={setAt} onClose={() => setAt(null)} eyebrow={eyebrow} /> : null}
    </>
  );
}
