import type { LineageTree, TreeNode } from "./lineage-types";
import type { TreeOrientation } from "./viewport-budget";

export type LayoutPos = { x: number; y: number };

export type ViewportSize = { width: number; height: number };

export type { TreeOrientation };

export type LaidOutTree = {
  positions: Map<string, LayoutPos>;
  width: number;
  height: number;
  meaningAnchor: LayoutPos;
  labelOffsetX: number;
  labelOffsetY: number;
  scale: number;
  orientation: TreeOrientation;
};

function absDepth(d: number): number {
  return Math.abs(d);
}

function estimateLabelWidth(label: string, depth: number): number {
  const ad = absDepth(depth);
  const base = ad === 0 ? 28 : ad === 1 ? 16 : 13;
  return Math.min(label.length, 22) * base * 0.55 + 28;
}

function estimateLabelHeight(depth: number): number {
  const ad = absDepth(depth);
  return ad === 0 ? 72 : ad === 1 ? 52 : 44;
}

function setPos(
  positions: Map<string, LayoutPos>,
  id: string,
  depth: number,
  axis: number,
  orientation: TreeOrientation,
  depthGap: number,
) {
  const cross = depth * depthGap;
  if (orientation === "horizontal") {
    positions.set(id, { x: cross, y: axis });
  } else {
    positions.set(id, { x: axis, y: cross });
  }
}

/** Leaf-weighted size so dense branches claim unused sibling space. */
function subtreeWeight(
  nodeId: string,
  childrenOf: Map<string, TreeNode[]>,
  direction: "desc" | "anc",
  byId: Map<string, TreeNode>,
  tree: LineageTree,
): number {
  const kids = nextNodes(nodeId, childrenOf, direction, byId, tree);
  if (kids.length === 0) return 1;
  let sum = 0;
  for (const k of kids) {
    sum += subtreeWeight(k.id, childrenOf, direction, byId, tree);
  }
  return Math.max(sum, kids.length);
}

function nextNodes(
  nodeId: string,
  childrenOf: Map<string, TreeNode[]>,
  direction: "desc" | "anc",
  byId: Map<string, TreeNode>,
  tree: LineageTree,
): TreeNode[] {
  if (direction === "desc") {
    return (childrenOf.get(nodeId) ?? []).filter((k) => k.depth > 0);
  }
  const depth = byId.get(nodeId)?.depth ?? 0;
  return tree.nodes.filter(
    (n) =>
      n.depth < depth &&
      tree.edges.some((e) => e.source === n.id && e.target === nodeId),
  );
}

/**
 * Split [axisMin, axisMax] into contiguous bands proportional to weights.
 * Returns { center, lo, hi } per item so children can fill their band.
 */
function weightedBands(
  weights: number[],
  axisMin: number,
  axisMax: number,
): Array<{ center: number; lo: number; hi: number }> {
  const n = weights.length;
  if (n === 0) return [];
  const span = Math.max(axisMax - axisMin, 1);
  const total = weights.reduce((a, b) => a + b, 0) || n;
  const gap = Math.min(span * 0.02, 12); // small gutter between bands
  const usable = Math.max(span - gap * Math.max(n - 1, 0), 1);
  let cursor = axisMin;
  const out: Array<{ center: number; lo: number; hi: number }> = [];
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 1;
    const band = (usable * w) / total;
    const lo = cursor;
    const hi = cursor + band;
    out.push({ center: (lo + hi) / 2, lo, hi });
    cursor = hi + (i < n - 1 ? gap : 0);
  }
  return out;
}

/**
 * Ancestors (depth < 0) left/above focus; descendants (depth > 0) right/below.
 * Breadth is weighted by subtree size — a lone dense branch stretches into
 * empty sibling space at deeper levels.
 */
function placeSignedTree(
  tree: LineageTree,
  orientation: TreeOrientation,
): Map<string, LayoutPos> {
  const positions = new Map<string, LayoutPos>();
  const focus = tree.nodes.find((n) => n.id === tree.rootId) ?? tree.nodes[0]!;
  const depthGap = 120;
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));

  const childrenOf = new Map<string, TreeNode[]>();
  for (const e of tree.edges) {
    const child = byId.get(e.target);
    if (!child) continue;
    const list = childrenOf.get(e.source) ?? [];
    list.push(child);
    childrenOf.set(e.source, list);
  }

  setPos(positions, focus.id, 0, 0, orientation, depthGap);

  const placeOutward = (
    nodeId: string,
    axisMin: number,
    axisMax: number,
    direction: "desc" | "anc",
  ) => {
    const next = nextNodes(nodeId, childrenOf, direction, byId, tree);
    if (next.length === 0) return;

    const weights = next.map((k) =>
      subtreeWeight(k.id, childrenOf, direction, byId, tree),
    );
    const bands = weightedBands(weights, axisMin, axisMax);

    next.forEach((kid, i) => {
      const band = bands[i]!;
      setPos(positions, kid.id, kid.depth, band.center, orientation, depthGap);
      // Children inherit nearly the full band (tiny inset) so a single
      // dense child can fill the parent's entire allocation.
      const pad = Math.min((band.hi - band.lo) * 0.04, 8);
      placeOutward(kid.id, band.lo + pad, band.hi - pad, direction);
    });
  };

  // Abstract extent from leaf weight, not just L1 count — deep fan-outs need room
  const descWeight = subtreeWeight(
    focus.id,
    childrenOf,
    "desc",
    byId,
    tree,
  );
  const ancWeight = subtreeWeight(focus.id, childrenOf, "anc", byId, tree);
  const unit = orientation === "horizontal" ? 52 : 72;
  const descSpan = Math.max(descWeight, 1) * unit;
  const ancSpan = Math.max(ancWeight, 1) * unit;

  placeOutward(focus.id, -descSpan / 2, descSpan / 2, "desc");
  placeOutward(focus.id, -ancSpan / 2, ancSpan / 2, "anc");

  // Sparse depths (e.g. 3 leaves under one parent) still nest in a tiny
  // band — stretch those rows across the full tree breadth.
  spreadSparseDepths(positions, tree, orientation);

  return positions;
}

/**
 * If a depth is owned by a single parent and its kids are clustered in a
 * tiny band, spread those siblings across the tree breadth.
 * Multi-parent depths stay hierarchical so bracket lines don't collapse
 * into one shared "bus".
 */
function spreadSparseDepths(
  positions: Map<string, LayoutPos>,
  tree: LineageTree,
  orientation: TreeOrientation,
) {
  const getB = (p: LayoutPos) => (orientation === "horizontal" ? p.y : p.x);
  const withB = (p: LayoutPos, b: number): LayoutPos =>
    orientation === "horizontal" ? { x: p.x, y: b } : { x: b, y: p.y };

  const byId = new Map(tree.nodes.map((n) => [n.id, n]));

  let globalLo = Infinity;
  let globalHi = -Infinity;
  for (const p of positions.values()) {
    const b = getB(p);
    globalLo = Math.min(globalLo, b);
    globalHi = Math.max(globalHi, b);
  }
  const span = globalHi - globalLo;
  if (!Number.isFinite(globalLo) || span < 1) return;

  const byDepth = new Map<number, string[]>();
  for (const n of tree.nodes) {
    if (!positions.has(n.id)) continue;
    const list = byDepth.get(n.depth) ?? [];
    list.push(n.id);
    byDepth.set(n.depth, list);
  }

  for (const ids of byDepth.values()) {
    if (ids.length < 2) continue;

    const parents = new Set(
      ids.map((id) => byId.get(id)?.parentId ?? id),
    );
    // Several parents at this depth — keep clusters under each parent
    if (parents.size !== 1) continue;

    const sorted = [...ids].sort(
      (a, b) => getB(positions.get(a)!) - getB(positions.get(b)!),
    );
    const lo = getB(positions.get(sorted[0]!)!);
    const hi = getB(positions.get(sorted[sorted.length - 1]!)!);
    if (hi - lo >= span * 0.65) continue;

    for (let i = 0; i < sorted.length; i++) {
      const t = i / (sorted.length - 1);
      const id = sorted[i]!;
      positions.set(id, withB(positions.get(id)!, globalLo + t * span));
    }
  }
}

function fitToViewport(
  tree: LineageTree,
  raw: Map<string, LayoutPos>,
  viewport: ViewportSize,
  orientation: TreeOrientation,
): { positions: Map<string, LayoutPos>; scale: number } {
  const { width, height } = viewport;

  const pad =
    orientation === "horizontal"
      ? {
          t: Math.max(88, height * 0.09),
          b: Math.max(56, height * 0.07),
          l: Math.max(96, width * 0.06),
          r: Math.max(140, width * 0.09),
        }
      : {
          t: Math.max(110, height * 0.11),
          b: Math.max(80, height * 0.09),
          l: Math.max(64, width * 0.06),
          r: Math.max(64, width * 0.06),
        };

  const usableW = Math.max(width - pad.l - pad.r, 60);
  const usableH = Math.max(height - pad.t - pad.b, 60);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of tree.nodes) {
    const p = raw.get(n.id);
    if (!p) continue;
    const lw = estimateLabelWidth(n.label, n.depth);
    const lh = estimateLabelHeight(n.depth);
    if (orientation === "horizontal") {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + lw);
      minY = Math.min(minY, p.y - lh * 0.35);
      maxY = Math.max(maxY, p.y + lh * 0.35);
    } else {
      minX = Math.min(minX, p.x - lw / 2);
      maxX = Math.max(maxX, p.x + lw / 2);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y + lh);
    }
  }

  if (!Number.isFinite(minX)) {
    return { positions: raw, scale: 1 };
  }

  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);

  let scaleX = usableW / bw;
  let scaleY = usableH / bh;

  // On ultrawide / ultra-tall screens, don't anisotropically blow out one axis —
  // cap the stretch ratio, then center the leftover space.
  const maxAniso = 1.75;
  if (scaleX > scaleY * maxAniso) scaleX = scaleY * maxAniso;
  if (scaleY > scaleX * maxAniso) scaleY = scaleX * maxAniso;

  const contentW = bw * scaleX;
  const contentH = bh * scaleY;
  const offsetX = pad.l + Math.max(0, (usableW - contentW) / 2);
  const offsetY = pad.t + Math.max(0, (usableH - contentH) / 2);

  const out = new Map<string, LayoutPos>();
  for (const [id, p] of raw) {
    out.set(id, {
      x: offsetX + (p.x - minX) * scaleX,
      y: offsetY + (p.y - minY) * scaleY,
    });
  }

  const uiScale = Math.min(
    Math.max(Math.min(scaleX, scaleY) * 0.95, 0.85),
    1.5,
  );

  return { positions: out, scale: uiScale };
}

function layoutInOrientation(
  tree: LineageTree,
  viewport: ViewportSize,
  orientation: TreeOrientation,
): LaidOutTree {
  const { width, height } = viewport;
  const raw = placeSignedTree(tree, orientation);
  const fitted = fitToViewport(tree, raw, viewport, orientation);
  const root = tree.nodes.find((n) => n.id === tree.rootId) ?? tree.nodes[0]!;
  const rootPos = fitted.positions.get(root.id) ?? {
    x: width / 2,
    y: height / 2,
  };

  return {
    positions: fitted.positions,
    width,
    height,
    meaningAnchor:
      orientation === "horizontal"
        ? { x: rootPos.x, y: rootPos.y + 64 * fitted.scale }
        : { x: rootPos.x, y: rootPos.y + 58 * fitted.scale },
    labelOffsetX: orientation === "horizontal" ? 14 * fitted.scale : 0,
    labelOffsetY: orientation === "vertical" ? 12 * fitted.scale : 0,
    scale: fitted.scale,
    orientation,
  };
}

export function orientationForViewport(
  viewport: ViewportSize,
): TreeOrientation {
  return viewport.height > viewport.width ? "vertical" : "horizontal";
}

export function layoutLineageTree(
  tree: LineageTree,
  viewport: ViewportSize,
): LaidOutTree {
  if (tree.nodes.length === 0) {
    return {
      positions: new Map(),
      width: viewport.width,
      height: viewport.height,
      meaningAnchor: { x: viewport.width / 2, y: viewport.height / 2 },
      labelOffsetX: 0,
      labelOffsetY: 0,
      scale: 1,
      orientation: orientationForViewport(viewport),
    };
  }
  return layoutInOrientation(
    tree,
    viewport,
    orientationForViewport(viewport),
  );
}

/**
 * Orthogonal connector. `route` is the shared elbow coordinate between two
 * depth columns so siblings fork from one spine instead of a mid-gap bus.
 */
export function bracketPath(
  from: LayoutPos,
  to: LayoutPos,
  orientation: TreeOrientation,
  fromOffset = 16,
  toOffset = 14,
  route?: number,
): string {
  if (orientation === "vertical") {
    const x1 = from.x;
    const y1 = from.y + fromOffset;
    const x2 = to.x;
    const y2 = to.y - toOffset;
    let midY = route ?? (y1 + y2) / 2;
    // Keep the elbow between the stubs
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    midY = Math.min(Math.max(midY, lo + 4), hi - 4);
    return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
  }
  const x1 = from.x + fromOffset;
  const y1 = from.y;
  const x2 = to.x - toOffset;
  const y2 = to.y;
  let midX = route ?? from.x + (to.x - from.x) * 0.4;
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  midX = Math.min(Math.max(midX, lo + 4), hi - 4);
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
}

/** Average dot position along the depth axis for nodes at `depth`. */
export function depthLane(
  tree: LineageTree,
  positions: Map<string, LayoutPos>,
  depth: number,
  orientation: TreeOrientation,
): number | null {
  let sum = 0;
  let n = 0;
  for (const node of tree.nodes) {
    if (node.depth !== depth) continue;
    const p = positions.get(node.id);
    if (!p) continue;
    sum += orientation === "horizontal" ? p.x : p.y;
    n++;
  }
  return n > 0 ? sum / n : null;
}
