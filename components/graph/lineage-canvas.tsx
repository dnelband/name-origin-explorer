"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FEATURED_ROTATE_MS } from "@/lib/graph-constants";
import { expandGroupInTree } from "@/lib/lineage-group";
import { bracketPath, depthLane, layoutLineageTree } from "@/lib/lineage-layout";
import type { FeaturedRoot, LineageTree, TreeNode } from "@/lib/lineage-types";
import { TreeSkeleton } from "./tree-skeleton";

type LineageCanvasProps = {
  focusNameId: string | null;
  onFocusChange: (id: string) => void;
};

type FeaturedPayload = {
  featured: FeaturedRoot[];
  trees: LineageTree[];
};

export function LineageCanvas({
  focusNameId,
  onFocusChange,
}: LineageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [tree, setTree] = useState<LineageTree | null>(null);
  const [featured, setFeatured] = useState<FeaturedRoot[]>([]);
  const [featuredTrees, setFeaturedTrees] = useState<LineageTree[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [boot, setBoot] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [paused, setPaused] = useState(false);
  const [meaning, setMeaning] = useState<{
    text: string | null;
    loading: boolean;
  } | null>(null);

  const userActiveRef = useRef(false);
  const genRef = useRef(0);
  const prevPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeElRef = useRef<Map<string, HTMLElement>>(new Map());
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const lastFetchSize = useRef({ w: 0, h: 0 });

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const showTreeRef = useRef<
    (rootId: string, opts?: { morph?: boolean }) => Promise<void>
  >(async () => {});

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let resizeTimer: number | undefined;
    const sync = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setViewport({ width: w, height: h });
    };
    sync();
    const ro = new ResizeObserver(() => {
      sync();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const { width, height } = viewportRef.current;
        const prev = lastFetchSize.current;
        // Ignore tiny resize noise (scrollbar, font load, etc.)
        if (
          Math.abs(width - prev.w) < 48 &&
          Math.abs(height - prev.h) < 48
        ) {
          return;
        }
        const focus = userActiveRef.current
          ? focusNameId
          : treeRef.current?.rootId ?? null;
        if (focus) void showTreeRef.current(focus, { morph: true });
      }, 320);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(resizeTimer);
    };
  }, [focusNameId]);

  const layout = useMemo(
    () => (tree ? layoutLineageTree(tree, viewport) : null),
    [tree, viewport],
  );

  const loadMeaning = useCallback(async (id: string) => {
    setMeaning({ text: null, loading: true });
    try {
      const res = await fetch(`/api/names/${id}`);
      if (!res.ok) {
        setMeaning({ text: null, loading: false });
        return;
      }
      const data = (await res.json()) as {
        enrichments?: { field: string; content: string; source?: string }[];
      };
      const list = data.enrichments ?? [];
      const text =
        list.find((e) => e.field === "description")?.content ??
        list.find((e) => e.field === "meaning")?.content ??
        list.find((e) => e.field === "usage")?.content ??
        list[0]?.content ??
        null;
      setMeaning({ text, loading: false });
    } catch {
      setMeaning({ text: null, loading: false });
    }
  }, []);

  const applyTree = useCallback(
    (next: LineageTree) => {
      setTree(next);
      void loadMeaning(next.rootId);
    },
    [loadMeaning],
  );

  const showTree = useCallback(
    async (rootId: string, _opts?: { morph?: boolean }) => {
      const generation = ++genRef.current;
      const { width, height } = viewportRef.current;
      lastFetchSize.current = { w: width, h: height };
      setFetching(true);
      try {
        const res = await fetch(
          `/api/graph/tree?root=${rootId}&w=${Math.round(width)}&h=${Math.round(height)}`,
        );
        if (!res.ok || generation !== genRef.current) return;
        const next = (await res.json()) as LineageTree;
        if (generation !== genRef.current) return;
        applyTree(next);
      } finally {
        if (generation === genRef.current) setFetching(false);
      }
    },
    [applyTree],
  );
  showTreeRef.current = showTree;

  useEffect(() => {
    const generation = ++genRef.current;
    let cancelled = false;
    (async () => {
      setBoot(true);
      const { width, height } = viewportRef.current;
      lastFetchSize.current = { w: width, h: height };
      const qs = `w=${Math.round(width)}&h=${Math.round(height)}`;

      // Deep-link / search focus: paint that tree immediately; featured is background
      if (focusNameId) {
        userActiveRef.current = true;
        setPaused(true);
        await showTree(focusNameId);
        if (generation !== genRef.current || cancelled) return;
        setBoot(false);

        const res = await fetch(`/api/graph/tree?featured=1&${qs}`);
        if (!res.ok || generation !== genRef.current || cancelled) return;
        const data = (await res.json()) as FeaturedPayload;
        setFeatured(data.featured);
        setFeaturedTrees(data.trees);

        if (data.featured.length > 1) {
          const restRes = await fetch(
            `/api/graph/tree?featured=1&rest=1&${qs}`,
          );
          if (!restRes.ok || generation !== genRef.current || cancelled) return;
          const restData = (await restRes.json()) as FeaturedPayload;
          setFeaturedTrees((prev) => {
            const byRoot = new Map(prev.map((t) => [t.rootId, t]));
            for (const t of restData.trees) byRoot.set(t.rootId, t);
            return data.featured
              .map((f) => byRoot.get(f.id))
              .filter((t): t is LineageTree => Boolean(t));
          });
        }
        return;
      }

      // Home: first featured tree → paint, then prefetch the rest
      const res = await fetch(`/api/graph/tree?featured=1&${qs}`);
      if (!res.ok || generation !== genRef.current || cancelled) return;
      const data = (await res.json()) as FeaturedPayload;
      setFeatured(data.featured);
      setFeaturedTrees(data.trees);

      if (data.trees[0]) applyTree(data.trees[0]);
      if (generation !== genRef.current || cancelled) return;
      setBoot(false);

      if (data.featured.length > 1) {
        const restRes = await fetch(`/api/graph/tree?featured=1&rest=1&${qs}`);
        if (!restRes.ok || generation !== genRef.current || cancelled) return;
        const restData = (await restRes.json()) as FeaturedPayload;
        setFeaturedTrees((prev) => {
          const byRoot = new Map(prev.map((t) => [t.rootId, t]));
          for (const t of restData.trees) byRoot.set(t.rootId, t);
          return data.featured
            .map((f) => byRoot.get(f.id))
            .filter((t): t is LineageTree => Boolean(t));
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boot) return;
    if (!focusNameId) {
      userActiveRef.current = false;
      setPaused(false);
      return;
    }
    userActiveRef.current = true;
    setPaused(true);
    void showTree(focusNameId);
  }, [focusNameId, boot, showTree]);

  useEffect(() => {
    if (boot || focusNameId) return;
    const t = featuredTrees[featuredIndex];
    if (!t) return;
    // Don't clobber a tree the user is already looking at with a stale index
    if (treeRef.current?.rootId === t.rootId) return;
    applyTree(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, focusNameId, featuredTrees, featuredIndex]);

  useEffect(() => {
    if (boot || paused || focusNameId || featuredTrees.length < 2) return;
    if (reducedMotion) return;

    const id = window.setInterval(() => {
      setFeaturedIndex((i) => {
        const next = (i + 1) % featuredTrees.length;
        // Prefer slots that are already loaded
        if (featuredTrees[next]) return next;
        return i;
      });
    }, FEATURED_ROTATE_MS);

    return () => window.clearInterval(id);
  }, [boot, paused, focusNameId, featuredTrees, reducedMotion]);

  // FLIP: animate shared nodes to new positions without remounting
  useLayoutEffect(() => {
    if (!layout || reducedMotion) {
      if (layout) prevPosRef.current = new Map(layout.positions);
      return;
    }

    for (const [id, el] of nodeElRef.current) {
      const next = layout.positions.get(id);
      const prev = prevPosRef.current.get(id);
      if (!next || !prev) continue;
      const dx = prev.x - next.x;
      const dy = prev.y - next.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.style.transition = "none";
      el.style.transform = `${el.dataset.baseTransform ?? ""} translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition =
        "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease";
      el.style.transform = el.dataset.baseTransform ?? "";
    }

    prevPosRef.current = new Map(layout.positions);
  }, [layout, reducedMotion, tree?.rootId]);

  const byId = useMemo(() => {
    const m = new Map<string, TreeNode>();
    for (const n of tree?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [tree]);

  const scale = layout?.scale ?? 1;
  const isVertical = layout?.orientation === "vertical";
  const depthCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of tree?.nodes ?? []) {
      const d = Math.abs(n.depth);
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [tree]);
  const rootSize = Math.round((isVertical ? 48 : 56) * scale);
  const l1Size = Math.round((isVertical ? 24 : 30) * scale);
  const l2Size = Math.round((isVertical ? 18 : 22) * scale);
  const sizeForDepth = (depth: number) => {
    const ad = Math.abs(depth);
    const count = depthCounts.get(ad) ?? 1;
    let base = l2Size;
    if (ad === 0) base = rootSize;
    else if (ad === 1) base = l1Size;
    // Keep labels readable when a depth is still relatively full
    const floor = ad === 0 ? 28 : ad === 1 ? 17 : 14;
    const crowd = Math.max(1, count / 6);
    return Math.max(floor, Math.round(base / Math.sqrt(crowd)));
  };

  const showSkeleton = boot || (fetching && !tree);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onPointerEnter={() => {
        if (!userActiveRef.current) setPaused(true);
      }}
      onPointerLeave={() => {
        if (!userActiveRef.current && !focusNameId) setPaused(false);
      }}
    >
      {showSkeleton ? <TreeSkeleton viewport={viewport} /> : null}

      {!showSkeleton && tree && layout ? (
        <div className="relative h-full w-full">
          <svg
            className="absolute inset-0"
            width={layout.width}
            height={layout.height}
            aria-hidden
          >
            {tree.edges.map((e) => {
              const from = layout.positions.get(e.source);
              const to = layout.positions.get(e.target);
              if (!from || !to) return null;
              const parent = byId.get(e.source);
              const child = byId.get(e.target);
              const parentFont = sizeForDepth(parent?.depth ?? 1);
              const parentHasMeta = Boolean(
                parent?.kind === "group" ||
                  parent?.language ||
                  (parent?.nativeLabel && parent.nativeLabel !== parent.label),
              );
              // Clear the label chip so connectors don't run through it
              const chipPad = 22;
              const metaH = parentHasMeta ? 18 : 0;
              const chipBody = parentFont + metaH + chipPad;

              let fromOffset: number;
              let toOffset: number;
              if (isVertical) {
                fromOffset =
                  layout.labelOffsetY + chipBody + 8 * scale;
                toOffset = 12 * scale;
              } else {
                const labelChars = Math.min(
                  (parent?.label ?? "").trim().length || 8,
                  18,
                );
                const chipW = Math.min(
                  parentFont * labelChars * 0.55 + 28,
                  viewport.width * 0.22,
                );
                fromOffset = layout.labelOffsetX + chipW + 6 * scale;
                toOffset = 12 * scale;
              }

              let route: number | undefined;
              if (parent && child) {
                const a = depthLane(
                  tree,
                  layout.positions,
                  parent.depth,
                  layout.orientation,
                );
                const b = depthLane(
                  tree,
                  layout.positions,
                  child.depth,
                  layout.orientation,
                );
                if (a != null && b != null) {
                  // Elbow between chips, not mid-gap through a parent label
                  const minClear = isVertical
                    ? from.y + fromOffset + 8
                    : from.x + fromOffset + 8;
                  const maxClear = isVertical
                    ? to.y - toOffset - 8
                    : to.x - toOffset - 8;
                  const ideal = a + (b - a) * 0.45;
                  route = Math.min(
                    Math.max(ideal, Math.min(minClear, maxClear)),
                    Math.max(minClear, maxClear),
                  );
                }
              }

              return (
                <path
                  key={`${e.source}-${e.target}`}
                  d={bracketPath(
                    from,
                    to,
                    layout.orientation,
                    fromOffset,
                    toOffset,
                    route,
                  )}
                  fill="none"
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth={1.25 * scale}
                />
              );
            })}
            {[...layout.positions.entries()].map(([id, pos]) => (
              <circle
                key={`dot-${id}`}
                cx={pos.x}
                cy={pos.y}
                r={(id === tree.rootId ? 4.5 : 3) * scale}
                fill={
                  id === tree.rootId
                    ? "#fff"
                    : byId.get(id)?.kind === "group"
                      ? "rgba(255,255,255,0.35)"
                      : "rgba(255,255,255,0.55)"
                }
                className="transition-all duration-[420ms] ease-out"
              />
            ))}
          </svg>

          {tree.nodes.map((n) => {
            const pos = layout.positions.get(n.id);
            if (!pos) return null;
            const isRoot = n.id === tree.rootId;
            const isGroup = n.kind === "group";
            const fontSize = isGroup
              ? Math.max(14, sizeForDepth(n.depth) * 0.85)
              : sizeForDepth(n.depth);
            const ad = Math.abs(n.depth);
            const baseTransform = isVertical
              ? "translateX(-50%)"
              : "translateY(-50%)";
            const displayName =
              (n.label.trim() && n.label.trim() !== "-"
                ? n.label.trim()
                : null) ||
              n.nativeLabel?.trim() ||
              "—";
            const meta = isGroup
              ? "tap to expand"
              : n.language ||
                (n.nativeLabel && n.nativeLabel !== n.label
                  ? n.nativeLabel
                  : null);

            const style = isVertical
              ? {
                  left: pos.x,
                  top: pos.y + layout.labelOffsetY,
                  textAlign: "center" as const,
                  maxWidth: isRoot
                    ? Math.min(480, viewport.width * 0.7)
                    : Math.min(
                        240,
                        Math.max(
                          110,
                          (viewport.width * 0.85) /
                            Math.max(
                              tree.nodes.filter(
                                (x) => Math.abs(x.depth) === Math.min(ad, 1),
                              ).length,
                              2,
                            ),
                        ),
                      ),
                }
              : {
                  left: pos.x + layout.labelOffsetX,
                  top: pos.y,
                  textAlign: "left" as const,
                  maxWidth: isRoot
                    ? Math.min(420, viewport.width * 0.4)
                    : Math.min(260, Math.max(130, viewport.width * 0.22)),
                };

            return (
              <button
                key={n.id}
                type="button"
                ref={(el) => {
                  if (el) {
                    nodeElRef.current.set(n.id, el);
                    el.dataset.baseTransform = baseTransform;
                  } else {
                    nodeElRef.current.delete(n.id);
                  }
                }}
                onClick={() => {
                  userActiveRef.current = true;
                  setPaused(true);
                  if (isGroup) {
                    setTree((prev) =>
                      prev ? expandGroupInTree(prev, n.id) : prev,
                    );
                    return;
                  }
                  onFocusChange(n.id);
                }}
                className="absolute cursor-pointer will-change-transform transition-opacity duration-300"
                style={{
                  ...style,
                  transform: baseTransform,
                  transition: reducedMotion
                    ? undefined
                    : "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease",
                }}
              >
                <span
                  className={[
                    "inline-flex max-w-full flex-col gap-1 rounded-xl border px-3 py-2",
                    isVertical ? "items-center" : "items-start",
                    isRoot
                      ? "border-white/25 bg-[#0c1014]"
                      : isGroup
                        ? "border-white/10 bg-[#0c1014]/95"
                        : "border-white/15 bg-[#0c1014]/95",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "leading-none tracking-tight",
                      isRoot || isGroup ? "" : "truncate",
                      isGroup ? "font-sans text-white/55 italic" : "font-serif",
                      isRoot
                        ? "text-white"
                        : ad === 1
                          ? "text-white/90"
                          : "text-white/80",
                    ].join(" ")}
                    style={{
                      fontSize,
                      ...(isRoot
                        ? { overflow: "visible", whiteSpace: "nowrap" }
                        : null),
                    }}
                  >
                    {displayName}
                  </span>
                  {meta ? (
                    <span
                      className={[
                        "font-sans tracking-wide",
                        isGroup ? "text-[11px] text-white/35" : "text-[12px] text-white/45",
                      ].join(" ")}
                    >
                      {meta}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}

          {meaning?.text ? (
            <div
              className={[
                "absolute font-sans",
                isVertical ? "-translate-x-1/2 text-center" : "text-left",
              ].join(" ")}
              style={{
                left: layout.meaningAnchor.x,
                top: layout.meaningAnchor.y,
                maxWidth: isVertical
                  ? Math.min(280, viewport.width * 0.7)
                  : Math.min(260, viewport.width * 0.22),
              }}
            >
              <p className="line-clamp-3 rounded-xl border border-white/10 bg-[#0c1014]/75 px-3 py-2 text-[14px] leading-relaxed text-white/50 backdrop-blur-sm sm:line-clamp-4 sm:text-[15px]">
                {meaning.text}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {!boot && !focusNameId && featured.length > 1 ? (
        <div className="absolute bottom-6 left-1/2 z-10 flex w-full max-w-4xl -translate-x-1/2 flex-wrap items-center justify-center gap-2 px-6">
          {featured.map((f, i) => {
            const treeLabel = featuredTrees
              .find((t) => t.rootId === f.id)
              ?.nodes.find((n) => n.id === f.id)?.label;
            const label = (treeLabel || f.label || "").trim();
            if (!label || label === "-") return null;
            const active = i === featuredIndex;
            return (
              <button
                key={f.id}
                type="button"
                disabled={active}
                onClick={() => {
                  setPaused(true);
                  setFeaturedIndex(i);
                }}
                className={[
                  "rounded-full border px-3.5 py-1.5 font-serif text-sm tracking-tight backdrop-blur-sm transition-colors duration-300",
                  active
                    ? "cursor-default border-white/30 bg-white/15 text-white"
                    : "cursor-pointer border-white/15 bg-[#0c1014]/75 text-white/45 hover:border-white/25 hover:bg-white/10 hover:text-white/80",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
