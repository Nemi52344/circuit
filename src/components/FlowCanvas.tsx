"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NODE_W, NODE_H, type Flow, type FlowNode, connect, disconnect } from "@/lib/flow";

/* The board a workflow is drawn on.

   Written by hand rather than pulled from a graph library: what is actually needed here is drag,
   a line between two points, and a click to join them — perhaps two hundred lines — against a
   dependency that brings a renderer, a store and a styling system of its own. The rest of Circuit
   has no runtime dependencies and this was not the place to start.

   Dragging moves a node. Clicking the dot under a node starts a line; clicking the dot on top of
   another finishes it. Clicking a line removes it. */

type Props = {
  flow: Flow;
  onChange: (flow: Flow) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  statuses?: Record<string, string>;
  readOnly?: boolean;
};

const PAD = 40;

export function FlowCanvas({ flow, onChange, selected, onSelect, statuses, readOnly }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [from, setFrom] = useState<{ id: string; branch?: "yes" | "no" } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  /* The drawing's own box, so the canvas grows with whatever is on it instead of clipping. */
  const box = useMemo(() => {
    const xs = flow.nodes.map((n) => n.x);
    const ys = flow.nodes.map((n) => n.y);
    const minX = Math.min(0, ...xs), minY = Math.min(0, ...ys);
    return {
      minX, minY,
      w: Math.max(...xs, 0) - minX + NODE_W + PAD * 2,
      h: Math.max(...ys, 0) - minY + NODE_H + PAD * 2,
    };
  }, [flow.nodes]);

  const at = useCallback((n: FlowNode) => ({ x: n.x - box.minX + PAD, y: n.y - box.minY + PAD }), [box]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left || 0) + (wrap.current?.scrollLeft || 0), y: e.clientY - (r?.top || 0) + (wrap.current?.scrollTop || 0) };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = point(e);
      onChange({
        ...flow,
        nodes: flow.nodes.map((n) => (n.id === drag.id ? { ...n, x: Math.round(p.x - drag.dx + box.minX - PAD), y: Math.round(p.y - drag.dy + box.minY - PAD) } : n)),
      });
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, flow, onChange, box]);

  useEffect(() => {
    if (!from) return;
    const move = (e: PointerEvent) => setGhost(point(e));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setFrom(null); setGhost(null); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("keydown", esc); };
  }, [from]);

  const startLine = (e: React.PointerEvent | React.MouseEvent, id: string, branch?: "yes" | "no") => {
    e.stopPropagation();
    if (readOnly) return;
    setFrom({ id, branch });
    setGhost(point(e));
  };

  const finishLine = (e: React.MouseEvent | React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (!from) return;
    const next = connect(flow, from.id, id, from.branch);
    if (next === flow) {
      /* connect() refuses a line that would make the run go round for ever, or one onto itself. */
      setFrom(null); setGhost(null);
      return;
    }
    onChange(next);
    setFrom(null);
    setGhost(null);
  };

  /* A line from the bottom of one node to the top of another, bowed so two lines between the same
     rows do not sit on top of each other. */
  const path = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const bend = Math.max(28, Math.abs(b.y - a.y) * 0.4);
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + bend}, ${b.x} ${b.y - bend}, ${b.x} ${b.y}`;
  };

  const out = (n: FlowNode, branch?: "yes" | "no") => {
    const p = at(n);
    const outs = flow.edges.filter((e) => e.from === n.id);
    if (n.kind !== "branch") return { x: p.x + NODE_W / 2, y: p.y + NODE_H };
    void outs;
    return { x: p.x + (branch === "no" ? NODE_W - 34 : 34), y: p.y + NODE_H };
  };
  const inp = (n: FlowNode) => { const p = at(n); return { x: p.x + NODE_W / 2, y: p.y }; };

  return (
    <div className={`flow-wrap ${from ? "linking" : ""}`} ref={wrap} onClick={() => { onSelect(null); setFrom(null); setGhost(null); }}>
      <div className="flow-canvas" style={{ width: box.w, height: box.h }}>
        <svg className="flow-lines" width={box.w} height={box.h}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {flow.edges.map((e) => {
            const a = flow.nodes.find((n) => n.id === e.from);
            const b = flow.nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            return (
              <g key={`${e.from}-${e.to}-${e.branch || ""}`} className={`flow-edge ${e.branch === "no" ? "no" : ""}`}>
                <path d={path(out(a, e.branch), inp(b))} markerEnd="url(#arrow)" />
                {!readOnly ? (
                  <path className="hit" d={path(out(a, e.branch), inp(b))}
                    onClick={(ev) => { ev.stopPropagation(); onChange(disconnect(flow, e.from, e.to)); }}>
                    <title>Click to remove this line</title>
                  </path>
                ) : null}
              </g>
            );
          })}
          {from && ghost ? (
            <path className="flow-ghost" d={path(out(flow.nodes.find((n) => n.id === from.id) as FlowNode, from.branch), ghost)} />
          ) : null}
        </svg>

        {flow.nodes.map((n) => {
          const p = at(n);
          const state = statuses?.[n.id];
          return (
            <div
              key={n.id}
              className={`flow-node k-${n.kind} ${selected === n.id ? "on" : ""} ${state ? `s-${state}` : ""} ${from && from.id !== n.id ? "joinable" : ""}`}
              style={{ left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H }}
              onClick={(e) => { e.stopPropagation(); if (from) finishLine(e, n.id); else onSelect(n.id); }}
              onPointerDown={(e) => {
                if (readOnly || from || n.kind === "trigger") return;
                if ((e.target as HTMLElement).closest(".port")) return;
                const p0 = point(e);
                setDrag({ id: n.id, dx: p0.x - p.x, dy: p0.y - p.y });
              }}
            >
              {n.kind !== "trigger" ? (
                <span className="port in" onClick={(e) => finishLine(e, n.id)} title="Lines come in here" />
              ) : null}
              <span className="fn-kind">{n.kind === "you" ? "you" : n.kind}</span>
              <strong>{n.title || "Untitled"}</strong>
              {state ? <span className={`fn-state ${state}`}>{state}</span> : null}
              {n.kind === "branch" ? (
                <>
                  <span className="port out yes" onPointerDown={(e) => startLine(e, n.id, "yes")} title="If yes, go this way" />
                  <span className="port out no" onPointerDown={(e) => startLine(e, n.id, "no")} title="If no, go this way" />
                  <span className="fn-yn"><i>yes</i><i>no</i></span>
                </>
              ) : (
                <span className="port out" onPointerDown={(e) => startLine(e, n.id)} title="Drag a line from here" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
