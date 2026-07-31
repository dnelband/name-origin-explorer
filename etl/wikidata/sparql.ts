import { NAME_ENTITY_TYPES } from "./constants";

function valuesBlock(items: readonly string[]): string {
  return items.map((q) => `wd:${q}`).join(" ");
}

/** Cursor pagination — works for mid-run resume; first page of large types may 504. */
export function namesCursorQuery(
  typeQid: string,
  afterQid: string | null,
  limit: number,
): string {
  const afterNum = afterQid ? Number.parseInt(afterQid.replace(/^Q/, ""), 10) : 0;
  const cursor =
    afterNum > 0 ? `FILTER(xsd:integer(?qidStr) > ${afterNum})` : "";
  return `
SELECT ?item ?itemLabel WHERE {
  ?item wdt:P31 wd:${typeQid} .
  BIND(STRAFTER(STR(?item), "entity/Q") AS ?qidStr)
  FILTER(STRSTARTS(STR(?item), "http://www.wikidata.org/entity/Q"))
  ${cursor}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?qidStr
LIMIT ${limit}
`.trim();
}

/**
 * Light QID-only listing within a URI digit prefix (no labels).
 * Used when CirrusSearch's 10k offset limit is exceeded.
 */
export function namesQidsByUriPrefixQuery(
  typeQid: string,
  uriPrefix: string,
  afterQid: string | null,
  limit: number,
): string {
  const base = `http://www.wikidata.org/entity/Q${uriPrefix}`;
  const after = afterQid
    ? `FILTER(STR(?item) > "http://www.wikidata.org/entity/${afterQid}")`
    : "";
  return `
SELECT ?item WHERE {
  ?item wdt:P31 wd:${typeQid} .
  FILTER(STRSTARTS(STR(?item), "${base}"))
  ${after}
}
ORDER BY ?item
LIMIT ${limit}
`.trim();
}

/** Per-type QID window — no global sort; reliable for large types on public endpoint. */
export function namesTypeWindowQuery(
  typeQid: string,
  minQid: number,
  maxQid: number,
): string {
  return `
SELECT ?item ?itemLabel WHERE {
  ?item wdt:P31 wd:${typeQid} .
  BIND(STRAFTER(STR(?item), "entity/Q") AS ?qidStr)
  FILTER(xsd:integer(?qidStr) >= ${minQid} && xsd:integer(?qidStr) < ${maxQid})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`.trim();
}

/** @deprecated OFFSET pagination — breaks at high offsets. Use namesCursorQuery. */
export function namesMinimalScrollQuery(
  typeQid: string,
  offset: number,
  limit: number,
): string {
  return `
SELECT ?item ?itemLabel WHERE {
  ?item wdt:P31 wd:${typeQid} .
  FILTER(STRSTARTS(STR(?item), "http://www.wikidata.org/entity/Q"))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?item
LIMIT ${limit}
OFFSET ${offset}
`.trim();
}

/** Heavier query with optional fields — use only for small batches. */
export function namesScrollQuery(offset: number, limit: number): string {
  return `
SELECT ?item ?itemLabel ?nativeLabel ?langLabel ?genderLabel ?description WHERE {
  VALUES ?type { ${valuesBlock(NAME_ENTITY_TYPES)} }
  ?item wdt:P31 ?type .
  OPTIONAL { ?item wdt:P1705 ?nativeLabel . }
  OPTIONAL {
    ?item wdt:P407 ?langItem .
    ?langItem rdfs:label ?langLabel .
    FILTER(LANG(?langLabel) = "en")
  }
  OPTIONAL {
    ?item wdt:P21 ?genderItem .
    ?genderItem rdfs:label ?genderLabel .
    FILTER(LANG(?genderLabel) = "en")
  }
  OPTIONAL {
    ?item schema:description ?description .
    FILTER(LANG(?description) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
ORDER BY ?item
LIMIT ${limit}
OFFSET ${offset}
`.trim();
}

export function cognateEdgesScrollQuery(offset: number, limit: number): string {
  return `
SELECT ?a ?b WHERE {
  VALUES ?type { ${valuesBlock(NAME_ENTITY_TYPES)} }
  ?a wdt:P31 ?type .
  ?b wdt:P31 ?type .
  ?a wdt:P460 ?b .
  FILTER(STR(?a) < STR(?b))
}
ORDER BY ?a ?b
LIMIT ${limit}
OFFSET ${offset}
`.trim();
}

/** Paginate by QID numeric range — scans sparse QID space. */
export function namesWindowQuery(minQid: number, maxQid: number): string {
  return `
SELECT ?item ?itemLabel WHERE {
  VALUES ?type { ${valuesBlock(NAME_ENTITY_TYPES)} }
  ?item wdt:P31 ?type .
  BIND(STRAFTER(STR(?item), "entity/Q") AS ?qidStr)
  FILTER(xsd:integer(?qidStr) >= ${minQid} && xsd:integer(?qidStr) < ${maxQid})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`.trim();
}

export function cognateEdgesWindowQuery(minQid: number, maxQid: number): string {
  return `
SELECT ?a ?b WHERE {
  VALUES ?type { ${valuesBlock(NAME_ENTITY_TYPES)} }
  ?a wdt:P31 ?type .
  ?b wdt:P31 ?type .
  ?a wdt:P460 ?b .
  BIND(STRAFTER(STR(?a), "entity/Q") AS ?aq)
  BIND(STRAFTER(STR(?b), "entity/Q") AS ?bq)
  FILTER(xsd:integer(?aq) >= ${minQid} && xsd:integer(?aq) < ${maxQid})
  FILTER(STR(?a) < STR(?b))
}
`.trim();
}

export function cognateEdgesForKnownQidsQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT ?a ?b WHERE {
  VALUES ?a { ${values} }
  VALUES ?type { ${valuesBlock(NAME_ENTITY_TYPES)} }
  ?a wdt:P460 ?b .
  ?b wdt:P31 ?type .
  FILTER(STR(?a) < STR(?b))
}
`.trim();
}

export function countNamesQuery(): string {
  return `
SELECT (COUNT(?item) AS ?count) WHERE {
  VALUES ?type { ${valuesBlock(NAME_ENTITY_TYPES)} }
  ?item wdt:P31 ?type .
}
`.trim();
}

export const QID_WINDOW_SIZE = 50_000;

export function* qidWindows(
  start: number,
  end: number,
  windowSize: number,
): Generator<[number, number]> {
  for (let min = start; min < end; min += windowSize) {
    yield [min, Math.min(min + windowSize, end)];
  }
}

export { NAME_ENTITY_TYPES };
