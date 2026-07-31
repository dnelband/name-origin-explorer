import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGivenNameEntry,
  mergeTransforms,
  parseTermSegment,
  splitFromChain,
  transformEntry,
  wiktionaryKey,
  type WiktextractEntry,
} from "./transform";

describe("parseTermSegment", () => {
  it("parses lang:term", () => {
    const r = parseTermSegment("fr:Édouard", "de");
    assert.equal(r?.key, "fr:édouard");
    assert.equal(r?.label, "Édouard");
    assert.equal(r?.langCode, "fr");
  });

  it("skips language-only origins", () => {
    assert.equal(parseTermSegment("Ancient Greek", "en"), null);
    assert.equal(parseTermSegment("Hebrew", "en"), null);
  });

  it("treats bare terms as same-language", () => {
    const r = parseTermSegment("Edward", "de");
    assert.equal(r?.key, "de:edward");
  });
});

describe("splitFromChain", () => {
  it("splits youngest to oldest", () => {
    assert.deepEqual(splitFromChain("fr:Édouard < en:Edward"), [
      "fr:Édouard",
      "en:Edward",
    ]);
  });
});

describe("isGivenNameEntry", () => {
  it("detects given name head template", () => {
    assert.equal(
      isGivenNameEntry({
        word: "Eduard",
        head_templates: [{ name: "given name", args: { "1": "de", "2": "male" } }],
      }),
      true,
    );
  });

  it("detects gloss", () => {
    assert.equal(
      isGivenNameEntry({
        word: "Bob",
        senses: [{ glosses: ["A male given name"] }],
      }),
      true,
    );
  });

  it("rejects non-names", () => {
    assert.equal(
      isGivenNameEntry({
        word: "run",
        senses: [{ glosses: ["to move quickly"] }],
      }),
      false,
    );
  });
});

describe("transformEntry", () => {
  it("emits derived_from from inh/bor/der etymology templates", () => {
    const entry: WiktextractEntry = {
      word: "Eduard",
      lang: "German",
      lang_code: "de",
      senses: [{ glosses: ["a male given name, equivalent to English Edward"] }],
      etymology_templates: [
        { name: "bor", args: { "1": "de", "2": "fr", "3": "Édouard" } },
        { name: "der", args: { "1": "de", "2": "en", "3": "Edward" } },
      ],
    };

    const { names, edges } = transformEntry(entry);
    assert.ok(names.some((n) => n.key === "de:eduard"));
    assert.ok(names.some((n) => n.key === "fr:édouard"));
    assert.ok(names.some((n) => n.key === "en:edward"));
    const types = edges.map(
      (e) => `${e.childKey}->${e.parentKey}:${e.relationType}`,
    );
    assert.ok(types.includes("de:eduard->fr:édouard:derived_from"));
    assert.ok(types.includes("de:eduard->en:edward:derived_from"));
  });

  it("emits diminutive from gloss and suffix template", () => {
    const entry: WiktextractEntry = {
      word: "Johnny",
      lang: "English",
      lang_code: "en",
      senses: [{ glosses: ["A diminutive of the male given name John."] }],
      etymology_templates: [
        { name: "suffix", args: { "1": "en", "2": "John", "3": "y" } },
      ],
    };
    const { edges } = transformEntry(entry);
    assert.ok(
      edges.some(
        (e) =>
          e.childKey === "en:johnny" &&
          e.parentKey === "en:john" &&
          e.relationType === "diminutive_of",
      ),
    );
  });

  it("emits descendant edges as derived_from toward the entry", () => {
    const entry: WiktextractEntry = {
      word: "Mary",
      lang_code: "en",
      senses: [{ glosses: ["A female given name from Hebrew."] }],
      descendants: [
        { lang: "Danish", lang_code: "da", word: "Mary", raw_tags: ["borrowed"] },
      ],
    };
    const { edges } = transformEntry(entry);
    assert.ok(
      edges.some(
        (e) =>
          e.childKey === "da:mary" &&
          e.parentKey === "en:mary" &&
          e.relationType === "derived_from",
      ),
    );
  });

  it("still supports given-name from= chains", () => {
    const entry: WiktextractEntry = {
      word: "Eduard",
      lang_code: "de",
      head_templates: [
        {
          name: "given name",
          args: {
            "1": "de",
            "2": "male",
            from: "fr:Édouard < en:Edward",
          },
        },
      ],
    };
    const { edges } = transformEntry(entry);
    const types = edges.map(
      (e) => `${e.childKey}->${e.parentKey}:${e.relationType}`,
    );
    assert.ok(types.includes("de:eduard->fr:édouard:derived_from"));
    assert.ok(types.includes("fr:édouard->en:edward:derived_from"));
  });
});

describe("mergeTransforms", () => {
  it("dedupes edges", () => {
    const a = transformEntry({
      word: "Jean",
      lang_code: "fr",
      senses: [{ glosses: ["a male given name"] }],
      etymology_templates: [
        { name: "der", args: { "1": "fr", "2": "en", "3": "John" } },
      ],
    });
    const merged = mergeTransforms([a, a]);
    assert.equal(merged.edges.length, 1);
    assert.equal(wiktionaryKey("fr", "Jean"), "fr:jean");
  });
});
