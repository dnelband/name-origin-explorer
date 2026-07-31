import { WIKIDATA_SPARQL_ENDPOINT, WIKIDATA_USER_AGENT } from "./constants";

export type SparqlBinding = {
  type: string;
  value: string;
  "xml:lang"?: string;
};

export type SparqlResult = {
  results: {
    bindings: Record<string, SparqlBinding>[];
  };
};

export class SparqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SparqlError";
  }
}

export async function runSparql(
  query: string,
  retries = 10,
): Promise<SparqlResult> {
  const url = new URL(WIKIDATA_SPARQL_ENDPOINT);
  url.searchParams.set("format", "json");

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
        "User-Agent": WIKIDATA_USER_AGENT,
      },
      body: query,
    });

    if (res.ok) {
      return (await res.json()) as SparqlResult;
    }

    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(60_000, 5000 * 2 ** attempt);
      console.warn(
        `SPARQL ${res.status}, retry ${attempt + 1}/${retries} in ${wait}ms…`,
      );
      await sleep(wait);
      continue;
    }

    const body = await res.text();
    throw new Error(`SPARQL failed (${res.status}): ${body.slice(0, 300)}`);
  }

  throw new SparqlError("SPARQL failed after retries");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bindingCount(result: SparqlResult): number {
  return result.results.bindings.length;
}

export function bindingValue(
  binding: Record<string, SparqlBinding>,
  key: string,
): string | undefined {
  return binding[key]?.value;
}
