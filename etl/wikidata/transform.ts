import { bindingValue, type SparqlResult } from "./fetch";
import { qidFromUri } from "../shared/db";

export type RawWikidataName = {
  qid: string;
  label: string;
  nativeLabel: string | null;
  language: string | null;
  gender: string | null;
  description: string | null;
};

export type RawCognateEdge = {
  qidA: string;
  qidB: string;
};

function normalizeGender(label: string | undefined): string | null {
  if (!label) return null;
  const lower = label.toLowerCase();
  if (lower.includes("female")) return "female";
  if (lower.includes("male") && !lower.includes("female")) return "male";
  if (lower.includes("unisex")) return "unisex";
  return label.toLowerCase();
}

export function dedupeNamesByQid(rows: RawWikidataName[]): RawWikidataName[] {
  const map = new Map<string, RawWikidataName>();

  for (const row of rows) {
    const existing = map.get(row.qid);
    if (!existing) {
      map.set(row.qid, { ...row });
      continue;
    }

    const score = (r: RawWikidataName) =>
      (r.language?.toLowerCase() === "english" ? 4 : 0) +
      (r.nativeLabel ? 2 : 0) +
      (r.description ? 1 : 0);

    const winner = score(row) >= score(existing) ? row : existing;
    const loser = winner === row ? existing : row;

    map.set(row.qid, {
      ...winner,
      nativeLabel: winner.nativeLabel ?? loser.nativeLabel,
      description: winner.description ?? loser.description,
      gender: winner.gender ?? loser.gender,
      language: winner.language ?? loser.language,
    });
  }

  return [...map.values()];
}

export function parseNamesResult(result: SparqlResult): RawWikidataName[] {
  const parsed = result.results.bindings
    .map((row) => {
      const item = bindingValue(row, "item");
      const label = bindingValue(row, "itemLabel");
      if (!item || !label) return null;

      const qid = qidFromUri(item);
      if (!qid) return null;

      return {
        qid,
        label: label.trim(),
        nativeLabel: bindingValue(row, "nativeLabel")?.trim() ?? null,
        language: bindingValue(row, "langLabel")?.trim() ?? null,
        gender: normalizeGender(bindingValue(row, "genderLabel")),
        description: bindingValue(row, "description")?.trim() ?? null,
      } satisfies RawWikidataName;
    })
    .filter((row): row is RawWikidataName => row !== null);

  return dedupeNamesByQid(parsed);
}

export function parseEdgesResult(result: SparqlResult): RawCognateEdge[] {
  return result.results.bindings
    .map((row) => {
      const a = bindingValue(row, "a");
      const b = bindingValue(row, "b");
      if (!a || !b) return null;
      const qidA = qidFromUri(a);
      const qidB = qidFromUri(b);
      if (!qidA || !qidB) return null;
      return { qidA, qidB } satisfies RawCognateEdge;
    })
    .filter((row): row is RawCognateEdge => row !== null);
}

export function parseCountResult(result: SparqlResult): number {
  const raw = bindingValue(result.results.bindings[0] ?? {}, "count");
  return raw ? Number.parseInt(raw, 10) : 0;
}
