import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocateSides, computeViewportCapacity } from "./viewport-budget";

describe("computeViewportCapacity", () => {
  it("uses depth on width for landscape", () => {
    const c = computeViewportCapacity({ width: 1400, height: 800 });
    assert.equal(c.orientation, "horizontal");
    assert.ok(c.depthSlots >= 3);
    assert.ok(c.breadthSlots >= 3);
  });

  it("uses depth on height for portrait", () => {
    const c = computeViewportCapacity({ width: 400, height: 900 });
    assert.equal(c.orientation, "vertical");
  });
});

describe("allocateSides", () => {
  const cap = computeViewportCapacity({ width: 1200, height: 700 });

  it("shows only parents when no children", () => {
    const a = allocateSides(cap, 4, 0);
    assert.equal(a.descendantDepth, 0);
    assert.ok(a.ancestorDepth >= 1);
  });

  it("keeps one parent when descendants are deep", () => {
    const a = allocateSides(cap, 3, 4);
    assert.equal(a.ancestorDepth, 1);
    assert.equal(a.ancestorFanout, 1);
    assert.ok(a.descendantDepth >= 3);
  });

  it("balances shallow both sides", () => {
    const a = allocateSides(cap, 2, 2);
    assert.ok(a.ancestorDepth >= 1);
    assert.ok(a.descendantDepth >= 1);
    assert.ok(a.ancestorDepth + a.descendantDepth <= cap.depthSlots - 1);
    assert.ok(a.ancestorDepth + a.descendantDepth >= 2);
  });
});
