import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  jaroWinkler,
  lookalikeScore,
  normalizeLabel,
  rankLookalikes,
} from "./lookalike";

describe("normalizeLabel", () => {
  it("strips accents and case", () => {
    assert.equal(normalizeLabel("Mária"), "maria");
    assert.equal(normalizeLabel("Zoë"), "zoe");
  });
});

describe("jaroWinkler", () => {
  it("scores near-identical names high", () => {
    assert.ok(jaroWinkler("maria", "marie") > 0.9);
    assert.ok(jaroWinkler("john", "jon") > 0.85);
  });

  it("scores unrelated short swaps lower than variants", () => {
    const variant = jaroWinkler("maria", "marie");
    const anagram = jaroWinkler("amy", "may");
    assert.ok(variant > anagram);
  });
});

describe("lookalikeScore", () => {
  it("accepts spelling variants", () => {
    assert.ok((lookalikeScore("Maria", "Marie") ?? 0) >= 0.72);
    assert.equal(lookalikeScore("Maria", "Mária"), 1);
    assert.ok((lookalikeScore("Katherine", "Catherine") ?? 0) >= 0.72);
  });

  it("rejects too-short or length-mismatched labels", () => {
    assert.equal(lookalikeScore("Li", "Lu"), null);
    assert.equal(lookalikeScore("Zoe", "Zoë"), null); // len 3 after normalize
    assert.equal(lookalikeScore("Jon", "John"), null); // len 3
    assert.equal(lookalikeScore("Alexander", "Alex"), null);
  });
});

describe("rankLookalikes", () => {
  it("returns top scored and excludes visited", () => {
    const ranked = rankLookalikes(
      "Maria",
      [
        { id: "1", label: "Marie" },
        { id: "2", label: "Mária" },
        { id: "3", label: "Potato" },
        { id: "4", label: "Mary" },
      ],
      new Set(["4"]),
      3,
    );
    assert.ok(ranked.every((r) => r.id !== "4"));
    assert.ok(ranked.every((r) => r.label !== "Potato"));
    assert.ok(ranked.length >= 1);
    assert.ok(ranked[0]!.score >= ranked.at(-1)!.score);
  });
});
