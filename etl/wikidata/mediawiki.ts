import { WIKIDATA_USER_AGENT } from "./constants";
import { sleep } from "./fetch";
import type { RawWikidataName } from "./transform";

const API = "https://www.wikidata.org/w/api.php";
/** CirrusSearch rejects sroffset >= this. */
export const SEARCH_OFFSET_LIMIT = 10_000;
const SEARCH_PAGE = 50;
const ENTITY_PAGE = 50;

export type SearchPage = {
  qids: string[];
  totalHits: number;
  nextOffset: number | null;
};

async function apiGet(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("format", "json");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": WIKIDATA_USER_AGENT,
          Accept: "application/json",
        },
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(60_000, 3000 * 2 ** attempt);
        const retryAfter = res.headers.get("retry-after");
        const delay = retryAfter ? Number(retryAfter) * 1000 : wait;
        console.warn(`MediaWiki ${res.status}, retry ${attempt + 1}/6 in ${delay}ms…`);
        await sleep(delay);
        continue;
      }

      const data = (await res.json()) as {
        error?: { code: string; info: string };
      };
      if (data.error) {
        throw new Error(`MediaWiki API: ${data.error.code} — ${data.error.info}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < 5) {
        const wait = Math.min(60_000, 3000 * 2 ** attempt);
        console.warn(`MediaWiki fetch failed, retry ${attempt + 1}/6 in ${wait}ms…`);
        await sleep(wait);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Enumerate items with P31=type via CirrusSearch (max ~10k results). */
export async function searchByInstanceOf(
  typeQid: string,
  offset: number,
  limit = SEARCH_PAGE,
): Promise<SearchPage> {
  if (offset >= SEARCH_OFFSET_LIMIT) {
    throw new Error(
      `Search offset ${offset} exceeds CirrusSearch limit (${SEARCH_OFFSET_LIMIT})`,
    );
  }

  const data = (await apiGet({
    action: "query",
    list: "search",
    srsearch: `haswbstatement:P31=${typeQid}`,
    srnamespace: "0",
    srlimit: String(Math.min(limit, SEARCH_PAGE)),
    sroffset: String(offset),
    srprop: "",
  })) as {
    continue?: { sroffset?: number };
    query: {
      searchinfo?: { totalhits?: number };
      search: { title: string }[];
    };
  };

  const qids = data.query.search
    .map((row) => row.title)
    .filter((title) => /^Q\d+$/.test(title));

  const totalHits = data.query.searchinfo?.totalhits ?? qids.length;
  const next =
    data.continue?.sroffset !== undefined ? data.continue.sroffset : null;

  return { qids, totalHits, nextOffset: next };
}

export async function getSearchTotalHits(typeQid: string): Promise<number> {
  const page = await searchByInstanceOf(typeQid, 0, 1);
  return page.totalHits;
}

type WbEntity = {
  id?: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
};

/** Fetch English labels/descriptions for QIDs (batches of 50). */
export async function fetchEntitiesAsNames(
  qids: string[],
  genderFromType: string | null,
): Promise<RawWikidataName[]> {
  const out: RawWikidataName[] = [];

  for (let i = 0; i < qids.length; i += ENTITY_PAGE) {
    const batch = qids.slice(i, i + ENTITY_PAGE);
    if (batch.length === 0) continue;

    const data = (await apiGet({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|descriptions",
      languages: "en",
      languagefallback: "1",
    })) as { entities: Record<string, WbEntity> };

    for (const qid of batch) {
      const entity = data.entities[qid];
      if (!entity || entity.missing !== undefined) continue;

      const label =
        entity.labels?.en?.value ??
        Object.values(entity.labels ?? {})[0]?.value;
      if (!label) continue;

      out.push({
        qid,
        label: label.trim(),
        nativeLabel: null,
        language: "English",
        gender: genderFromType,
        description: entity.descriptions?.en?.value?.trim() ?? null,
      });
    }

    if (i + ENTITY_PAGE < qids.length) await sleep(200);
  }

  return out;
}

export function genderForNameType(typeQid: string): string | null {
  switch (typeQid) {
    case "Q11879590":
      return "female";
    case "Q12308941":
      return "male";
    case "Q3409032":
      return "unisex";
    default:
      return null;
  }
}
