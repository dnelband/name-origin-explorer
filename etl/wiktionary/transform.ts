/** Wiktextract / kaikki.org given-name lineage extraction. */

export type LineageRelationType =
  | "derived_from"
  | "diminutive_of"
  | "variant_of";

export type WiktionaryNameRef = {
  /** Stable key: `${langCode}:${normalizedLemma}` */
  key: string;
  langCode: string;
  label: string;
  language: string | null;
};

export type WiktionaryLineageEdge = {
  childKey: string;
  parentKey: string;
  relationType: LineageRelationType;
  sourceUrl: string;
};

export type WiktionaryNameRow = WiktionaryNameRef & {
  gender: string | null;
  sourceUrl: string;
};

export type TransformResult = {
  names: WiktionaryNameRow[];
  edges: WiktionaryLineageEdge[];
};

export type WiktextractTemplate = {
  name?: string;
  args?: Record<string, string>;
  expansion?: string;
};

export type WiktextractDescendant = {
  lang?: string;
  lang_code?: string;
  word?: string;
  raw_tags?: string[];
  depth?: number;
  templates?: WiktextractTemplate[];
};

/** Minimal Wiktextract entry shape we care about. */
export type WiktextractEntry = {
  word?: string;
  lang?: string;
  lang_code?: string;
  pos?: string;
  head_templates?: WiktextractTemplate[];
  etymology_templates?: WiktextractTemplate[];
  descendants?: WiktextractDescendant[];
  senses?: Array<{
    glosses?: string[];
    raw_glosses?: string[];
    tags?: string[];
    categories?: string[];
    links?: Array<[string, string] | string[]>;
    head_templates?: WiktextractTemplate[];
  }>;
  categories?: string[];
};

const GIVEN_NAME_RE = /\bgiven names?\b/i;
const DIMINUTIVE_OF_RE =
  /\bdiminutive of (?:the )?(?:male |female |unisex )?(?:given )?name\s+([^.,;]+)/i;
const VARIANT_OF_RE =
  /\b(?:variant|form) of (?:the )?(?:male |female |unisex )?(?:given )?name\s+([^.,;]+)/i;

const ETYM_EDGE_TEMPLATES = new Set([
  "inh",
  "inherited",
  "bor",
  "borrowed",
  "der",
  "derived",
]);

/** Map common Wiktionary language names → codes. */
const LANG_NAME_TO_CODE: Record<string, string> = {
  english: "en",
  french: "fr",
  german: "de",
  spanish: "es",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  irish: "ga",
  welsh: "cy",
  polish: "pl",
  czech: "cs",
  russian: "ru",
  greek: "el",
  "ancient greek": "grc",
  latin: "la",
  hebrew: "he",
  "biblical hebrew": "hbo",
  arabic: "ar",
  aramaic: "arc",
  "old french": "fro",
  "middle english": "enm",
  "old english": "ang",
  "old norse": "non",
};

export function normalizeLemma(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function wiktionaryKey(langCode: string, label: string): string {
  return `${langCode.toLowerCase()}:${normalizeLemma(label).toLowerCase()}`;
}

export function pageUrl(word: string): string {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replace(/ /g, "_"))}`;
}

function langCodeFromName(name: string): string | null {
  return LANG_NAME_TO_CODE[name.trim().toLowerCase()] ?? null;
}

/**
 * Parse a single term segment (`fr:Édouard`, bare `Edward`, or language-only).
 */
export function parseTermSegment(
  raw: string,
  fallbackLang: string,
): WiktionaryNameRef | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;

  const noInline = trimmed.replace(/<[a-z]+:[^>]*>/gi, "").trim();
  if (!noInline) return null;

  const colon = noInline.indexOf(":");
  if (colon > 0 && colon < 12) {
    const maybeLang = noInline.slice(0, colon).trim().toLowerCase();
    const term = noInline.slice(colon + 1).trim();
    if (/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(maybeLang) && term) {
      const label = normalizeLemma(term);
      return {
        key: wiktionaryKey(maybeLang, label),
        langCode: maybeLang,
        label,
        language: null,
      };
    }
  }

  if (
    langCodeFromName(noInline) ||
    /^[A-Z][a-z]+( [A-Z][a-z]+)* languages?$/.test(noInline)
  ) {
    return null;
  }

  const label = normalizeLemma(noInline);
  if (!label) return null;
  return {
    key: wiktionaryKey(fallbackLang, label),
    langCode: fallbackLang,
    label,
    language: null,
  };
}

/** Split `from=` value into chain segments (youngest → oldest). */
export function splitFromChain(fromValue: string): string[] {
  return fromValue
    .split(/\s+<\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function collectGivenNameTemplates(
  entry: WiktextractEntry,
): WiktextractTemplate[] {
  const out: WiktextractTemplate[] = [];
  for (const t of entry.head_templates ?? []) {
    if (t.name === "given name" || t.name === "given name of") out.push(t);
  }
  for (const sense of entry.senses ?? []) {
    for (const t of sense.head_templates ?? []) {
      if (t.name === "given name" || t.name === "given name of") out.push(t);
    }
  }
  return out;
}

export function isGivenNameEntry(entry: WiktextractEntry): boolean {
  if (collectGivenNameTemplates(entry).length > 0) return true;

  const cats = [
    ...(entry.categories ?? []),
    ...(entry.senses ?? []).flatMap((s) => s.categories ?? []),
  ];
  if (cats.some((c) => GIVEN_NAME_RE.test(c))) return true;

  for (const sense of entry.senses ?? []) {
    const glosses = [
      ...(sense.glosses ?? []),
      ...(sense.raw_glosses ?? []),
    ];
    if (glosses.some((g) => GIVEN_NAME_RE.test(g))) return true;
    if ((sense.links ?? []).some((l) => GIVEN_NAME_RE.test(String(l[0] ?? "")))) {
      return true;
    }
  }
  return false;
}

function genderFromGlosses(entry: WiktextractEntry): string | null {
  const text = (entry.senses ?? [])
    .flatMap((s) => [...(s.glosses ?? []), ...(s.raw_glosses ?? [])])
    .join(" ")
    .toLowerCase();
  if (/\bfemale given name\b/.test(text)) return "female";
  if (/\bmale given name\b/.test(text)) return "male";
  if (/\bunisex given name\b/.test(text)) return "unisex";
  return null;
}

function genderFromArgs(args: Record<string, string> | undefined): string | null {
  if (!args) return null;
  const g = (args["2"] ?? args.gender ?? "").split(",")[0]?.trim().toLowerCase();
  if (g === "male" || g === "female" || g === "unisex") return g;
  return null;
}

function collectArgValues(
  args: Record<string, string> | undefined,
  base: string,
): string[] {
  if (!args) return [];
  const out: string[] = [];
  if (args[base]) out.push(args[base]);
  for (let i = 2; i <= 12; i++) {
    const v = args[`${base}${i}`];
    if (v) out.push(v);
  }
  return out;
}

function parentFromEtymTemplate(
  t: WiktextractTemplate,
): WiktionaryNameRef | null {
  const name = (t.name ?? "").toLowerCase();
  if (!ETYM_EDGE_TEMPLATES.has(name)) return null;
  const args = t.args ?? {};
  const srcLang = (args["2"] ?? "").trim().toLowerCase();
  const term = (args["3"] ?? "").trim();
  if (!srcLang || !term || term.startsWith("*")) return null;
  // Skip reconstructed / empty
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(srcLang)) return null;
  const label = normalizeLemma(term);
  if (!label) return null;
  return {
    key: wiktionaryKey(srcLang, label),
    langCode: srcLang,
    label,
    language: null,
  };
}

/**
 * Transform one Wiktextract entry into name rows + directed lineage edges.
 */
export function transformEntry(entry: WiktextractEntry): TransformResult {
  const word = entry.word?.trim();
  const langCode = (entry.lang_code ?? "en").toLowerCase();
  if (!word || !isGivenNameEntry(entry)) {
    return { names: [], edges: [] };
  }

  const sourceUrl = pageUrl(word);
  const childLabel = normalizeLemma(word);
  const childKey = wiktionaryKey(langCode, childLabel);
  const templates = collectGivenNameTemplates(entry);

  let gender = genderFromGlosses(entry);
  for (const t of templates) {
    gender = genderFromArgs(t.args) ?? gender;
  }

  const namesByKey = new Map<string, WiktionaryNameRow>();
  namesByKey.set(childKey, {
    key: childKey,
    langCode,
    label: childLabel,
    language: entry.lang ?? null,
    gender,
    sourceUrl,
  });

  const edges: WiktionaryLineageEdge[] = [];
  const edgeKeys = new Set<string>();

  const ensureName = (ref: WiktionaryNameRef) => {
    if (namesByKey.has(ref.key)) return;
    namesByKey.set(ref.key, {
      ...ref,
      gender: null,
      sourceUrl: pageUrl(ref.label),
    });
  };

  const addEdge = (
    child: string,
    parent: WiktionaryNameRef,
    relationType: LineageRelationType,
  ) => {
    if (parent.key === child) return;
    const ek = `${child}|${parent.key}|${relationType}`;
    if (edgeKeys.has(ek)) return;
    edgeKeys.add(ek);
    ensureName(parent);
    edges.push({
      childKey: child,
      parentKey: parent.key,
      relationType,
      sourceUrl,
    });
  };

  // 1) Classic given-name head template from=/dimof/varof (rare in dump, keep)
  for (const t of templates) {
    const args = t.args ?? {};
    for (const fromRaw of collectArgValues(args, "from")) {
      const segments = splitFromChain(fromRaw);
      const parsed = segments
        .map((s) => parseTermSegment(s, langCode))
        .filter((p): p is WiktionaryNameRef => p !== null);
      if (parsed[0]) addEdge(childKey, parsed[0], "derived_from");
      for (let i = 0; i < parsed.length - 1; i++) {
        const younger = parsed[i]!;
        const older = parsed[i + 1]!;
        ensureName(younger);
        addEdge(younger.key, older, "derived_from");
      }
    }
    for (const raw of collectArgValues(args, "dimof")) {
      for (const part of raw.split(",")) {
        const parent = parseTermSegment(part, langCode);
        if (parent) addEdge(childKey, parent, "diminutive_of");
      }
    }
    for (const raw of collectArgValues(args, "varof")) {
      for (const part of raw.split(",")) {
        const parent = parseTermSegment(part, langCode);
        if (parent) addEdge(childKey, parent, "variant_of");
      }
    }
  }

  // 2) Etymology templates: inh / bor / der → derived_from
  for (const t of entry.etymology_templates ?? []) {
    const parent = parentFromEtymTemplate(t);
    if (parent) addEdge(childKey, parent, "derived_from");

    // {{suffix|en|John|y}} → diminutive/variant of John
    if ((t.name ?? "").toLowerCase() === "suffix") {
      const base = (t.args?.["2"] ?? "").trim();
      if (base) {
        const parentRef = parseTermSegment(base, langCode);
        if (parentRef) addEdge(childKey, parentRef, "diminutive_of");
      }
    }
  }

  // 3) Gloss: "diminutive of the male given name John"
  for (const sense of entry.senses ?? []) {
    for (const g of [
      ...(sense.glosses ?? []),
      ...(sense.raw_glosses ?? []),
    ]) {
      const dim = g.match(DIMINUTIVE_OF_RE);
      if (dim?.[1]) {
        const parent = parseTermSegment(dim[1], langCode);
        if (parent) addEdge(childKey, parent, "diminutive_of");
      }
      const variant = g.match(VARIANT_OF_RE);
      if (variant?.[1]) {
        const parent = parseTermSegment(variant[1], langCode);
        if (parent) addEdge(childKey, parent, "variant_of");
      }
    }
  }

  // 4) Descendants section: this entry is parent of listed forms
  for (const d of entry.descendants ?? []) {
    const dWord = d.word?.trim();
    const dLang = (d.lang_code ?? "").toLowerCase();
    if (!dWord || !dLang) continue;
    const childRef: WiktionaryNameRef = {
      key: wiktionaryKey(dLang, dWord),
      langCode: dLang,
      label: normalizeLemma(dWord),
      language: d.lang ?? null,
    };
    ensureName(childRef);
    addEdge(childRef.key, {
      key: childKey,
      langCode,
      label: childLabel,
      language: entry.lang ?? null,
    }, "derived_from");
  }

  return { names: [...namesByKey.values()], edges };
}

/** Merge many entries (dedupe names + edges). */
export function mergeTransforms(results: TransformResult[]): TransformResult {
  const namesByKey = new Map<string, WiktionaryNameRow>();
  const edges: WiktionaryLineageEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const r of results) {
    for (const n of r.names) {
      const prev = namesByKey.get(n.key);
      if (!prev) {
        namesByKey.set(n.key, n);
      } else {
        namesByKey.set(n.key, {
          ...prev,
          gender: prev.gender ?? n.gender,
          language: prev.language ?? n.language,
        });
      }
    }
    for (const e of r.edges) {
      const ek = `${e.childKey}|${e.parentKey}|${e.relationType}`;
      if (edgeKeys.has(ek)) continue;
      edgeKeys.add(ek);
      edges.push(e);
    }
  }

  return { names: [...namesByKey.values()], edges };
}
