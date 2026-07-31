"use client";

import { orientationForViewport, type ViewportSize } from "@/lib/lineage-layout";

/** Placeholder tree: 1 → 2 → 4 → 8 → 16 along depth. */
const DEPTH_COUNTS = [1, 2, 4, 8, 16] as const;

type TreeSkeletonProps = {
  viewport: ViewportSize;
};

export function TreeSkeleton({ viewport }: TreeSkeletonProps) {
  const orientation = orientationForViewport(viewport);
  const isVertical = orientation === "vertical";
  const { width, height } = viewport;

  // Layout in a normalized box, then center in the viewport so ultrawide
  // screens don't pin the skeleton to the left edge.
  const innerW = Math.min(width * 0.84, isVertical ? width * 0.9 : 1100);
  const innerH = Math.min(height * 0.72, isVertical ? 720 : height * 0.78);
  const originX = (width - innerW) / 2;
  const originY = (height - innerH) / 2;

  const depthSlots = DEPTH_COUNTS.length;
  const depthGap = isVertical
    ? innerH / (depthSlots - 0.15)
    : innerW / (depthSlots - 0.15);

  const nodes: Array<{ x: number; y: number; depth: number; i: number }> = [];
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  DEPTH_COUNTS.forEach((count, depth) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const breadth = isVertical
        ? originX + innerW * (0.1 + t * 0.8)
        : originY + innerH * (0.1 + t * 0.8);
      const cross = isVertical
        ? originY + depth * depthGap * 0.92
        : originX + depth * depthGap * 0.92;
      const x = isVertical ? breadth : cross;
      const y = isVertical ? cross : breadth;
      nodes.push({ x, y, depth, i });

      if (depth > 0) {
        const parentCount = DEPTH_COUNTS[depth - 1]!;
        const parentI = Math.min(Math.floor(i / 2), parentCount - 1);
        const parent = nodes.find(
          (n) => n.depth === depth - 1 && n.i === parentI,
        );
        if (parent) {
          edges.push({ x1: parent.x, y1: parent.y, x2: x, y2: y });
        }
      }
    }
  });

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <svg width={width} height={height} className="absolute inset-0">
        {edges.map((e, idx) => {
          const mid = isVertical
            ? `M ${e.x1} ${e.y1} V ${(e.y1 + e.y2) / 2} H ${e.x2} V ${e.y2}`
            : `M ${e.x1} ${e.y1} H ${(e.x1 + e.x2) / 2} V ${e.y2} H ${e.x2}`;
          return (
            <path
              key={idx}
              d={mid}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((n, idx) => {
          const pillW = n.depth === 0 ? 88 : Math.max(40, 64 - n.depth * 6);
          const pillH = n.depth === 0 ? 14 : 9;
          const pillX = isVertical ? n.x - pillW / 2 : n.x + 12;
          const pillY = isVertical ? n.y + 10 : n.y - pillH / 2;
          return (
            <g
              key={idx}
              className="tree-skeleton-pulse"
              style={{ animationDelay: `${n.depth * 90}ms` }}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={n.depth === 0 ? 4 : 2.5}
                fill="rgba(255,255,255,0.14)"
              />
              <rect
                x={pillX}
                y={pillY}
                width={pillW}
                height={pillH}
                rx={4}
                fill="rgba(255,255,255,0.08)"
              />
            </g>
          );
        })}
      </svg>
      <p className="absolute bottom-8 left-1/2 -translate-x-1/2 font-sans text-[11px] tracking-wide text-white/25">
        Loading lineage…
      </p>
    </div>
  );
}
