import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createEtlDb } from "./shared/db";
import { downloadKaikkiDump, extractFromDump } from "./wiktionary/stream";
import { loadWiktionaryLineage } from "./wiktionary/load";

config({ path: ".env.local" });

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const fixture = hasFlag("--fixture");
  const dumpArg = argValue("--dump");
  const download = hasFlag("--download");

  let dumpPath =
    dumpArg ??
    process.env.WIKTIONARY_DUMP_PATH ??
    (fixture
      ? resolve(process.cwd(), "etl/wiktionary/fixtures/given-names.sample.jsonl")
      : resolve(process.cwd(), "data/raw-wiktextract-data.jsonl.gz"));

  if (download) {
    dumpPath = resolve(process.cwd(), "data/raw-wiktextract-data.jsonl.gz");
    console.log(`Downloading kaikki dump → ${dumpPath} (large)…`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
    await downloadKaikkiDump(dumpPath);
  }

  if (!existsSync(dumpPath)) {
    throw new Error(
      `Dump not found: ${dumpPath}\n` +
        `Pass --fixture for the sample JSONL, --dump <path>, or --download.`,
    );
  }

  console.log(`Extracting given-name lineage from ${dumpPath}…`);
  const data = await extractFromDump(dumpPath);
  console.log(`Names: ${data.names.length}; edges: ${data.edges.length}`);

  if (hasFlag("--dry-run")) {
    console.log("Dry run — not writing to DB.");
    console.log("Sample edges:", data.edges.slice(0, 8));
    return;
  }

  const { db, client } = createEtlDb();
  try {
    const result = await loadWiktionaryLineage(db, data);
    console.log(
      `Loaded Wiktionary lineage: ${result.names} names, ${result.edges} edges.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
