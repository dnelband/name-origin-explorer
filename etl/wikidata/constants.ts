export const WIKIDATA_SPARQL_ENDPOINT =
  "https://query.wikidata.org/sparql";

export const WIKIDATA_USER_AGENT =
  "NameOrigins/1.0 (https://github.com/dnelband/name-origin-explorer; etl@name-origins.local)";

/** P31 instance-of values for etymological given names. */
export const NAME_ENTITY_TYPES = [
  "Q202444", // given name
  "Q11879590", // female given name
  "Q12308941", // male given name
  "Q3409032", // unisex given name
] as const;

export const DEFAULT_BATCH_SIZE = 400;

export const MAX_CLOSURE_COMPONENT_SIZE = 80;
