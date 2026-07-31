import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeNamesByQid, parseNamesResult } from "./transform";

describe("dedupeNamesByQid", () => {
  it("keeps one row per QID and prefers English", () => {
    const rows = dedupeNamesByQid([
      {
        qid: "Q923",
        label: "Alexander",
        nativeLabel: "Alexander",
        language: "German",
        gender: null,
        description: null,
      },
      {
        qid: "Q923",
        label: "Alexander",
        nativeLabel: null,
        language: "English",
        gender: "male",
        description: "A common name",
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].language, "English");
    assert.equal(rows[0].gender, "male");
  });
});

describe("parseNamesResult", () => {
  it("skips lexeme URIs (L prefix)", () => {
    const rows = parseNamesResult({
      results: {
        bindings: [
          {
            item: { type: "uri", value: "http://www.wikidata.org/entity/Q123" },
            itemLabel: { type: "literal", value: "Maria" },
          },
          {
            item: {
              type: "uri",
              value: "http://www.wikidata.org/entity/L1013360",
            },
            itemLabel: { type: "literal", value: "bad" },
          },
        ],
      },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].qid, "Q123");
  });
});
