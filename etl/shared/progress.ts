import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type WikidataProgress = {
  phase: "names" | "edges";
  type: string | null;
  after: string | null;
  /** Next QID window start when using --mode type-window. */
  windowStart: number | null;
  /** CirrusSearch sroffset when using search mode (≤10k types). */
  searchOffset: number | null;
  /** URI digit prefix for SPARQL shard path (e.g. "12"). */
  uriPrefix: string | null;
  /** Remaining URI prefixes to process for the current type. */
  pendingPrefixes: string[];
  completedTypes: string[];
};

const PROGRESS_FILE = resolve(process.cwd(), ".etl-wikidata-progress.json");

export function loadProgress(): WikidataProgress | null {
  try {
    const raw = readFileSync(PROGRESS_FILE, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WikidataProgress>;
    return {
      phase: parsed.phase ?? "names",
      type: parsed.type ?? null,
      after: parsed.after ?? null,
      windowStart: parsed.windowStart ?? null,
      searchOffset: parsed.searchOffset ?? null,
      uriPrefix: parsed.uriPrefix ?? null,
      pendingPrefixes: parsed.pendingPrefixes ?? [],
      completedTypes: parsed.completedTypes ?? [],
    };
  } catch {
    return null;
  }
}

export function saveProgress(progress: WikidataProgress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2) + "\n");
}

export function clearProgress() {
  try {
    writeFileSync(PROGRESS_FILE, "");
  } catch {
    // ignore
  }
}

export function qidNumeric(qid: string): number {
  return Number.parseInt(qid.replace(/^Q/, ""), 10);
}

export function maxQid(qids: string[]): string | null {
  if (qids.length === 0) return null;
  return qids.reduce((max, qid) =>
    qidNumeric(qid) > qidNumeric(max) ? qid : max,
  );
}
