import React, { useEffect, useRef, useState } from "react";
export const clampZoom = (value: number) => Math.max(1, Math.min(8, value));
export function ZoomSurface({
  scale,
  onScale,
  children,
}: {
  scale: number;
  onScale: (n: number) => void;
  children: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(scale),
    change = useRef(onScale);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  current.current = scale;
  change.current = onScale;
  useEffect(() => {
    if (scale === 1) setPan({ x: 0, y: 0 });
  }, [scale]);
  useEffect(() => {
    const el = host.current!;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        change.current(clampZoom(current.current * Math.exp(-e.deltaY * 0.01)));
      } else if (current.current > 1) {
        e.preventDefault();
        setPan((p) => bound(p.x - e.deltaX, p.y - e.deltaY));
      }
    };
    const bound = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(
          (-r.width * (current.current - 1)) / 2,
          Math.min((r.width * (current.current - 1)) / 2, x),
        ),
        y: Math.max(
          (-r.height * (current.current - 1)) / 2,
          Math.min((r.height * (current.current - 1)) / 2, y),
        ),
      };
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div
      ref={host}
      className="zoom-surface"
      style={{ cursor: scale > 1 ? "grab" : "default" }}
      onDoubleClick={() => onScale(scale > 1 ? 1 : 2)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        const points = pointers.current,
          old = points.get(e.pointerId);
        if (!old) return;
        const other = [...points.entries()].find(
          ([id]) => id !== e.pointerId,
        )?.[1];
        if (other) {
          const before = Math.hypot(old.x - other.x, old.y - other.y),
            after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          if (before > 0) onScale(clampZoom((scale * after) / before));
        } else if (scale > 1) {
          const r = e.currentTarget.getBoundingClientRect(),
            mx = (r.width * (scale - 1)) / 2,
            my = (r.height * (scale - 1)) / 2;
          setPan((p) => ({
            x: Math.max(-mx, Math.min(mx, p.x + e.clientX - old.x)),
            y: Math.max(-my, Math.min(my, p.y + e.clientY - old.y)),
          }));
        }
        points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }}
      onPointerUp={(e) => pointers.current.delete(e.pointerId)}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
    >
      <div
        className="zoom-content"
        style={{
          transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
