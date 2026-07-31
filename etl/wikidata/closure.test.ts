import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeClosure } from "./closure";

describe("computeClosure", () => {
  it("closes a chain A-B-C into all pairs", () => {
    const { edges, skippedLargeComponents } = computeClosure(
      [
        { qidA: "A", qidB: "B" },
        { qidA: "B", qidB: "C" },
      ],
      80,
    );

    assert.equal(skippedLargeComponents, 0);
    const keys = new Set(edges.map((e) => `${e.a}|${e.b}`));
    assert.ok(keys.has("A|B"));
    assert.ok(keys.has("B|C"));
    assert.ok(keys.has("A|C"));
  });

  it("canonicalizes edge ordering", () => {
    const { edges } = computeClosure([{ qidA: "Z", qidB: "A" }], 80);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].a, "A");
    assert.equal(edges[0].b, "Z");
  });

  it("skips full closure for oversized components", () => {
    const direct = [
      { qidA: "A", qidB: "B" },
      { qidA: "B", qidB: "C" },
      { qidA: "C", qidB: "D" },
    ];
    const { edges, skippedLargeComponents } = computeClosure(direct, 3);
    assert.equal(skippedLargeComponents, 1);
    assert.equal(edges.length, 3);
  });
});
