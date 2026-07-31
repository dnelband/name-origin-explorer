import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutLineageTree } from "./lineage-layout";
import type { LineageTree } from "./lineage-types";

describe("layoutLineageTree sparse depth spread", () => {
  it("spreads a few deep leaves across full breadth", () => {
    // Focus → A,B (wide) → only A has three leaf kids (would nest tightly)
    const tree: LineageTree = {
      rootId: "r",
      nodes: [
        {
          id: "r",
          label: "Root",
          nativeLabel: null,
          language: null,
          gender: null,
          wikidataQid: null,
          depth: 0,
          parentId: null,
        },
        {
          id: "a",
          label: "A",
          nativeLabel: null,
          language: null,
          gender: null,
          wikidataQid: null,
          depth: 1,
          parentId: "r",
        },
        {
          id: "b",
          label: "B",
          nativeLabel: null,
          language: null,
          gender: null,
          wikidataQid: null,
          depth: 1,
          parentId: "r",
        },
        {
          id: "c1",
          label: "C1",
          nativeLabel: null,
          language: null,
          gender: null,
          wikidataQid: null,
          depth: 2,
          parentId: "a",
        },
        {
          id: "c2",
          label: "C2",
          nativeLabel: null,
          language: null,
          gender: null,
          wikidataQid: null,
          depth: 2,
          parentId: "a",
        },
        {
          id: "c3",
          label: "C3",
          nativeLabel: null,
          language: null,
          gender: null,
          wikidataQid: null,
          depth: 2,
          parentId: "a",
        },
      ],
      edges: [
        { source: "r", target: "a" },
        { source: "r", target: "b" },
        { source: "a", target: "c1" },
        { source: "a", target: "c2" },
        { source: "a", target: "c3" },
      ],
    };

    const laid = layoutLineageTree(tree, { width: 1200, height: 800 });
    const ys = ["c1", "c2", "c3"].map((id) => laid.positions.get(id)!.y);
    ys.sort((a, b) => a - b);
    const leafSpan = ys[2]! - ys[0]!;

    const allY = [...laid.positions.values()].map((p) => p.y);
    const globalSpan = Math.max(...allY) - Math.min(...allY);

    // Depth-2 leaves should use most of the tree's vertical (breadth) span
    assert.ok(
      leafSpan > globalSpan * 0.7,
      `expected leaf span ${leafSpan} > 70% of ${globalSpan}`,
    );
  });
});
