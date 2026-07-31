/**
 * On-demand spelling lookalikes — not cognates.
 * Used when a name has few/no P460 edges so the graph isn't empty.
 */

const MIN_LABEL_LEN = 4;
const MAX_LENGTH_DELTA = 2;
/** Inclusive floor — below this is too weak to show. */
export const LOOKALIKE_MIN_SCORE = 0.72;
/** Cap how many lookalikes we attach to a sparse root. */
export const LOOKALIKE_LIMIT = 6;
/** Fetch this many trgm candidates before JW re-rank. */
export const LOOKALIKE_CANDIDATE_LIMIT = 80;
/** Add lookalikes when cognate hop-1 count is below this. */
export const LOOKALIKE_TRIGGER_DEGREE = 3;

export function normalizeLabel(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Jaro similarity (0–1). */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchDistance = Math.max(
    Math.floor(Math.max(a.length, b.length) / 2) - 1,
    0,
  );
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/** Jaro–Winkler similarity (0–1), favors shared prefixes. */
export function jaroWinkler(a: string, b: string, p = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return j + prefix * p * (1 - j);
}

export function lookalikeScore(labelA: string, labelB: string): number | null {
  const a = normalizeLabel(labelA);
  const b = normalizeLabel(labelB);
  if (a.length < MIN_LABEL_LEN || b.length < MIN_LABEL_LEN) return null;
  if (Math.abs(a.length - b.length) > MAX_LENGTH_DELTA) return null;
  if (a === b) return 1;
  const score = jaroWinkler(a, b);
  if (score < LOOKALIKE_MIN_SCORE) return null;
  return score;
}

export type LookalikeCandidate = {
  id: string;
  label: string;
  score: number;
};

export function rankLookalikes(
  rootLabel: string,
  candidates: { id: string; label: string }[],
  excludeIds: Set<string>,
  limit = LOOKALIKE_LIMIT,
): LookalikeCandidate[] {
  const scored: LookalikeCandidate[] = [];

  for (const c of candidates) {
    if (excludeIds.has(c.id)) continue;
    const score = lookalikeScore(rootLabel, c.label);
    if (score == null) continue;
    scored.push({ id: c.id, label: c.label, score });
  }

  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return scored.slice(0, limit);
}
