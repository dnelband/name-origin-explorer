import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  isGivenNameEntry,
  mergeTransforms,
  transformEntry,
  type TransformResult,
  type WiktextractEntry,
} from "./transform";

const KAIKKI_RAW_GZ =
  "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";

export async function streamJsonlFile(
  path: string,
  onEntry: (entry: WiktextractEntry) => void | Promise<void>,
): Promise<{ lines: number; givenNames: number }> {
  const isGz = path.endsWith(".gz");
  const input = isGz
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path);

  const rl = createInterface({ input, crlfDelay: Infinity });
  let lines = 0;
  let givenNames = 0;

  for await (const line of rl) {
    lines++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: WiktextractEntry;
    try {
      entry = JSON.parse(trimmed) as WiktextractEntry;
    } catch {
      continue;
    }
    if (!isGivenNameEntry(entry)) continue;
    givenNames++;
    await onEntry(entry);
  }

  return { lines, givenNames };
}

/** Download kaikki dump to a local path (streaming). */
export async function downloadKaikkiDump(destPath: string): Promise<void> {
  const res = await fetch(KAIKKI_RAW_GZ, {
    headers: {
      "User-Agent": "NameOrigins/1.0 (etl; lineage; contact via github)",
    },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download kaikki dump: ${res.status}`);
  }

  const nodeStream = Readable.fromWeb(
    res.body as import("stream/web").ReadableStream,
  );
  await pipeline(nodeStream, createWriteStream(destPath));
}

/**
 * Extract all given-name lineage from a Wiktextract JSONL (.gz ok).
 * Accumulates in memory — given-name subset is far smaller than the full dump.
 */
export async function extractFromDump(path: string): Promise<TransformResult> {
  const results: TransformResult[] = [];
  const stats = await streamJsonlFile(path, (entry) => {
    results.push(transformEntry(entry));
  });
  console.log(
    `Scanned ${stats.lines} lines; ${stats.givenNames} given-name entries.`,
  );
  return mergeTransforms(results);
}

export { KAIKKI_RAW_GZ };
