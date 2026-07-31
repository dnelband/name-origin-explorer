import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseOvercrowdedDepth,
  collapseOvercrowdedSiblings,
  expandGroupInTree,
} from "./lineage-group";
import type { LineageTree } from "./lineage-types";

function sampleTree(): LineageTree {
  // root → 6 leaf children
  const nodes = [
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
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      label: `Child${i}`,
      nativeLabel: null,
      language: "English",
      gender: null,
      wikidataQid: null,
      depth: 1,
      parentId: "r",
    })),
  ];
  // give c0 two kids so it ranks higher
  nodes.push(
    {
      id: "g0",
      label: "Grand0",
      nativeLabel: null,
      language: null,
      gender: null,
      wikidataQid: null,
      depth: 2,
      parentId: "c0",
    },
    {
      id: "g1",
      label: "Grand1",
      nativeLabel: null,
      language: null,
      gender: null,
      wikidataQid: null,
      depth: 2,
      parentId: "c0",
    },
  );
  const edges = [
    ...Array.from({ length: 6 }, (_, i) => ({
      source: "r",
      target: `c${i}`,
    })),
    { source: "c0", target: "g0" },
    { source: "c0", target: "g1" },
  ];
  return { rootId: "r", nodes, edges };
}

/** Two parents at depth 1, each with many leaf children at depth 2. */
function bushyDepthTree(): LineageTree {
  const nodes: LineageTree["nodes"] = [
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
  ];
  const edges: LineageTree["edges"] = [
    { source: "r", target: "a" },
    { source: "r", target: "b" },
  ];
  for (const parent of ["a", "b"] as const) {
    for (let i = 0; i < 5; i++) {
      const id = `${parent}${i}`;
      nodes.push({
        id,
        label: `${parent.toUpperCase()}${i}`,
        nativeLabel: null,
        language: "English",
        gender: null,
        wikidataQid: null,
        depth: 2,
        parentId: parent,
      });
      edges.push({ source: parent, target: id });
    }
  }
  return { rootId: "r", nodes, edges };
}

describe("collapseOvercrowdedSiblings", () => {
  it("groups excess leaves and keeps the branchy child", () => {
    const collapsed = collapseOvercrowdedSiblings(sampleTree(), 3);
    const rootKids = collapsed.edges
      .filter((e) => e.source === "r")
      .map((e) => e.target);
    assert.ok(rootKids.includes("c0"));
    assert.ok(rootKids.some((id) => id.startsWith("group:")));
    assert.ok(collapsed.nodes.some((n) => n.kind === "group"));
    const group = collapsed.nodes.find((n) => n.kind === "group")!;
    assert.ok((group.members?.length ?? 0) >= 3);
  });

  it("expands a group back into members", () => {
    const collapsed = collapseOvercrowdedSiblings(sampleTree(), 3);
    const group = collapsed.nodes.find((n) => n.kind === "group")!;
    const expanded = expandGroupInTree(collapsed, group.id);
    assert.equal(expanded.nodes.some((n) => n.id === group.id), false);
    assert.ok((group.members?.length ?? 0) > 0);
    assert.ok(
      group.members!.every((m) => expanded.nodes.some((n) => n.id === m.id)),
    );
  });
});

describe("collapseOvercrowdedDepth", () => {
  it("caps total nodes at a depth by grouping leaves first", () => {
    const collapsed = collapseOvercrowdedDepth(bushyDepthTree(), 4);
    const depth2 = collapsed.nodes.filter((n) => Math.abs(n.depth) === 2);
    assert.ok(depth2.length <= 4);
    assert.ok(depth2.some((n) => n.kind === "group"));
  });
});
