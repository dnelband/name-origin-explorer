export type TreeOrientation = "horizontal" | "vertical";

export type ViewportSize = { width: number; height: number };

/** How many depth/breadth slots the viewport can hold. */
export type ViewportCapacity = {
  orientation: TreeOrientation;
  /** Total depth columns/rows including focus (2–7). */
  depthSlots: number;
  /** Max siblings across the breadth axis at the focus level. */
  breadthSlots: number;
  maxNodes: number;
};

export type SideAllocation = {
  ancestorDepth: number;
  descendantDepth: number;
  /** At ancestor depth -1, cap parents (1 when deep descendants). */
  ancestorFanout: number;
  rootFanout: number;
  branchFanout: number;
  maxNodes: number;
  orientation: TreeOrientation;
};

const MIN_DEPTH_PX = 130;
const MIN_BREADTH_PX = 78;
const PAD = 160;

export function computeViewportCapacity(
  viewport: ViewportSize,
): ViewportCapacity {
  const orientation: TreeOrientation =
    viewport.height > viewport.width ? "vertical" : "horizontal";
  const depthAxis =
    orientation === "horizontal" ? viewport.width : viewport.height;
  const breadthAxis =
    orientation === "horizontal" ? viewport.height : viewport.width;

  const depthSlots = clamp(
    Math.floor(Math.max(depthAxis - PAD, 200) / MIN_DEPTH_PX),
    2,
    7,
  );
  const breadthSlots = clamp(
    Math.floor(Math.max(breadthAxis - PAD, 120) / MIN_BREADTH_PX),
    3,
    14,
  );
  const maxNodes = clamp(depthSlots * Math.min(breadthSlots, 8), 8, 48);

  return { orientation, depthSlots, breadthSlots, maxNodes };
}

/**
 * Balance parents ↔ focus ↔ children against available hops and screen slots.
 * - Deep descendant trees (≥3 hops): only the most immediate parent.
 * - No children: spend the budget on ancestors.
 * - Otherwise: fill both sides to use the depth axis.
 */
export function allocateSides(
  capacity: ViewportCapacity,
  availableAncestorHops: number,
  availableDescendantHops: number,
): SideAllocation {
  const budget = capacity.depthSlots - 1;
  const rootFanout = capacity.breadthSlots;
  const branchFanout = Math.max(2, Math.ceil(capacity.breadthSlots / 2));

  let ancestorDepth = 0;
  let descendantDepth = 0;
  let ancestorFanout = rootFanout;

  if (availableDescendantHops <= 0) {
    ancestorDepth = Math.min(budget, availableAncestorHops);
    descendantDepth = 0;
    ancestorFanout = rootFanout;
  } else if (availableDescendantHops >= 3) {
    ancestorDepth = Math.min(1, availableAncestorHops);
    descendantDepth = Math.min(budget - ancestorDepth, availableDescendantHops);
    ancestorFanout = 1; // most immediate parent only
  } else if (availableAncestorHops <= 0) {
    ancestorDepth = 0;
    descendantDepth = Math.min(budget, availableDescendantHops);
  } else {
    // Both sides have data — proportional split, at least 1 each when budget ≥ 2
    if (budget >= 2) {
      const total = availableAncestorHops + availableDescendantHops;
      ancestorDepth = clamp(
        Math.round((budget * availableAncestorHops) / total),
        1,
        Math.min(availableAncestorHops, budget - 1),
      );
      descendantDepth = Math.min(budget - ancestorDepth, availableDescendantHops);
    } else {
      // Only one hop of screen — prefer descendants
      descendantDepth = Math.min(1, availableDescendantHops);
      ancestorDepth = descendantDepth === 0 ? Math.min(1, availableAncestorHops) : 0;
    }
    // Spend leftover on whichever side still has room
    let leftover = budget - ancestorDepth - descendantDepth;
    if (leftover > 0 && availableDescendantHops > descendantDepth) {
      const add = Math.min(leftover, availableDescendantHops - descendantDepth);
      descendantDepth += add;
      leftover -= add;
    }
    if (leftover > 0 && availableAncestorHops > ancestorDepth) {
      ancestorDepth += Math.min(leftover, availableAncestorHops - ancestorDepth);
    }
    ancestorFanout = ancestorDepth >= 1 ? Math.min(rootFanout, 3) : 0;
  }

  return {
    ancestorDepth,
    descendantDepth,
    ancestorFanout: Math.max(ancestorFanout, ancestorDepth > 0 ? 1 : 0),
    rootFanout,
    branchFanout,
    maxNodes: capacity.maxNodes,
    orientation: capacity.orientation,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
