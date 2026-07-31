import { config } from "dotenv";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  cognateEdgesForKnownQidsQuery,
  cognateEdgesScrollQuery,
  cognateEdgesWindowQuery,
  countNamesQuery,
  NAME_ENTITY_TYPES,
  namesCursorQuery,
  namesQidsByUriPrefixQuery,
  namesTypeWindowQuery,
  namesWindowQuery,
  qidWindows,
  QID_WINDOW_SIZE,
} from "./wikidata/sparql";
import { DEFAULT_BATCH_SIZE, MAX_CLOSURE_COMPONENT_SIZE } from "./wikidata/constants";
import { runSparql, sleep, bindingCount, SparqlError } from "./wikidata/fetch";
import {
  parseCountResult,
  parseEdgesResult,
  parseNamesResult,
  type RawCognateEdge,
} from "./wikidata/transform";
import { computeClosure } from "./wikidata/closure";
import {
  countTable,
  loadQidMap,
  upsertNames,
  upsertRelations,
  upsertWikidataDescriptions,
} from "./wikidata/load";
import {
  fetchEntitiesAsNames,
  genderForNameType,
  getSearchTotalHits,
  SEARCH_OFFSET_LIMIT,
  searchByInstanceOf,
} from "./wikidata/mediawiki";
import { createEtlDb, qidFromUri } from "./shared/db";
import {
  clearProgress,
  loadProgress,
  maxQid,
  qidNumeric,
  saveProgress,
  type WikidataProgress,
} from "./shared/progress";

config({ path: ".env.local" });

type Db = PostgresJsDatabase<typeof import("@/db/schema")>;
type Mode = "search" | "scroll" | "window" | "type-window";

type Options = {
  mode: Mode;
  pageSize: number;
  maxPages: number | null;
  qidStart: number;
  qidEnd: number;
  windowSize: number;
  maxWindows: number | null;
  scrollOffset: number;
  nameType: string | null;
  afterQid: string | null;
  resume: boolean;
  namesOnly: boolean;
  edgesOnly: boolean;
  skipClosure: boolean;
};

function emptyProgressFields(
  partial: Partial<WikidataProgress> & Pick<WikidataProgress, "completedTypes">,
): WikidataProgress {
  return {
    phase: partial.phase ?? "names",
    type: partial.type ?? null,
    after: partial.after ?? null,
    windowStart: partial.windowStart ?? null,
    searchOffset: partial.searchOffset ?? null,
    uriPrefix: partial.uriPrefix ?? null,
    pendingPrefixes: partial.pendingPrefixes ?? [],
    completedTypes: partial.completedTypes,
  };
}

function initialUriPrefixes(): string[] {
  // Two-digit prefixes keep each SPARQL shard well under CirrusSearch's 10k limit.
  const prefixes: string[] = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      prefixes.push(`${a}${b}`);
    }
  }
  return prefixes;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  return {
    mode: (get("--mode") as Mode) ?? "search",
    pageSize: Number(get("--page-size") ?? DEFAULT_BATCH_SIZE),
    maxPages: get("--max-pages") ? Number(get("--max-pages")) : null,
    qidStart: Number(get("--qid-start") ?? 1),
    qidEnd: Number(get("--qid-end") ?? 100_000_000),
    windowSize: Number(get("--window-size") ?? QID_WINDOW_SIZE),
    maxWindows: get("--max-windows") ? Number(get("--max-windows")) : null,
    scrollOffset: Number(get("--offset") ?? 0),
    nameType: get("--type") ?? null,
    afterQid: get("--after") ?? null,
    resume: has("--resume"),
    namesOnly: has("--names-only"),
    edgesOnly: has("--edges-only"),
    skipClosure: has("--skip-closure"),
  };
}

async function ingestNamesScroll(db: Db, opts: Options) {
  let total = 0;
  const saved = loadProgress();
  const completedTypes = new Set(saved?.completedTypes ?? []);

  if (opts.scrollOffset > 0) {
    console.warn(
      "--offset is deprecated and unreliable on Wikidata. Use --after Qxxxxx or --resume instead.",
    );
  }

  if (
    opts.nameType &&
    completedTypes.has(opts.nameType) &&
    !opts.afterQid &&
    !opts.resume
  ) {
    const remaining = NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));
    console.log(`Type ${opts.nameType} is already complete.`);
    if (remaining.length > 0) {
      console.log(`Continue: pnpm etl:wikidata --names-only --type ${remaining[0]}`);
    } else {
      console.log("All name types done. Run: pnpm etl:wikidata --edges-only");
    }
    return;
  }

  const types = opts.nameType
    ? [opts.nameType]
    : NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));

  if (types.length === 0) {
    console.log("All name types already loaded. Run edges: pnpm etl:wikidata --edges-only");
    return;
  }

  try {
    const countResult = await runSparql(countNamesQuery());
    const estimated = parseCountResult(countResult);
    console.log(`Wikidata names (estimate): ~${estimated.toLocaleString()}`);
  } catch {
    console.log("Count query skipped (timeout) — proceeding with ingest.");
  }

  for (const typeQid of types) {
    let after: string | null =
      opts.afterQid && (opts.nameType === typeQid || !opts.nameType)
        ? opts.afterQid
        : null;

    if (saved?.type === typeQid && saved.after && opts.resume && !opts.afterQid) {
      after = saved.after;
    }

    let pages = 0;
    let typeTotal = 0;

    console.log(`\n── Type ${typeQid}${after ? ` (after ${after})` : ""} ──`);

    while (true) {
      if (opts.maxPages !== null && pages >= opts.maxPages) break;

      console.log(`Fetching ${typeQid}${after ? ` after ${after}` : ""}…`);
      const result = await runSparql(
        namesCursorQuery(typeQid, after, opts.pageSize),
      );
      const rawCount = bindingCount(result);
      if (rawCount === 0) {
        console.log(`  Type ${typeQid} complete (no more results).`);
        break;
      }

      const rows = parseNamesResult(result);
      const lastQid = maxQid(rows.map((r) => r.qid));

      if (rows.length > 0) {
        const qidMap = await upsertNames(db, rows);
        await upsertWikidataDescriptions(db, rows, qidMap);
        total += rows.length;
        typeTotal += rows.length;
        console.log(
          `  upserted ${rows.length} (type ${typeTotal}, run total ${total}, raw ${rawCount})`,
        );
      } else {
        console.log(`  skipped ${rawCount} non-Q rows`);
      }

      if (lastQid) {
        after = lastQid;
        saveProgress(
          emptyProgressFields({
            phase: "names",
            type: typeQid,
            after,
            completedTypes: [...completedTypes],
          }),
        );
        console.log(`  resume: pnpm etl:wikidata --names-only --resume`);
      }

      pages++;
      if (rawCount < opts.pageSize) {
        console.log(`  Type ${typeQid} complete (${typeTotal} this type).`);
        break;
      }
      await sleep(2500);
    }

    completedTypes.add(typeQid);
    saveProgress(
      emptyProgressFields({
        phase: "names",
        completedTypes: [...completedTypes],
      }),
    );

    const remaining = NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));
    if (remaining.length > 0 && !opts.nameType) {
      console.log(`Next type: ${remaining[0]}`);
    }
  }

  const counts = await countTable(db);
  console.log(
    `Names in DB: ${counts.names}, enrichments: ${counts.enrichments}`,
  );

  if (completedTypes.size === NAME_ENTITY_TYPES.length) {
    console.log("All name types done. Run: pnpm etl:wikidata --edges-only");
    clearProgress();
  }
}

async function ingestNamesTypeWindow(db: Db, opts: Options) {
  let total = 0;
  const saved = loadProgress();
  const completedTypes = new Set(saved?.completedTypes ?? []);

  if (
    opts.nameType &&
    completedTypes.has(opts.nameType) &&
    !opts.resume
  ) {
    const remaining = NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));
    console.log(`Type ${opts.nameType} is already complete.`);
    if (remaining.length > 0) {
      console.log(`Continue: pnpm etl:wikidata --names-only --type ${remaining[0]}`);
    } else {
      console.log("All name types done. Run: pnpm etl:wikidata --edges-only");
    }
    return;
  }

  const types = opts.nameType
    ? [opts.nameType]
    : NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));

  if (types.length === 0) {
    console.log("All name types already loaded. Run edges: pnpm etl:wikidata --edges-only");
    return;
  }

  for (const typeQid of types) {
    let startQid = opts.qidStart;
    if (saved?.type === typeQid && saved.windowStart && opts.resume) {
      startQid = saved.windowStart;
    }

    let windows = 0;
    let typeTotal = 0;

    console.log(`\n── Type ${typeQid} (QID windows from ${startQid}) ──`);

    for (const [minQid, maxQid] of qidWindows(
      startQid,
      opts.qidEnd,
      opts.windowSize,
    )) {
      if (opts.maxWindows !== null && windows >= opts.maxWindows) break;

      console.log(`Fetching ${typeQid} Q${minQid}–Q${maxQid - 1}…`);
      const result = await runSparql(
        namesTypeWindowQuery(typeQid, minQid, maxQid),
      );
      const rows = parseNamesResult(result);

      if (rows.length > 0) {
        const qidMap = await upsertNames(db, rows);
        await upsertWikidataDescriptions(db, rows, qidMap);
        total += rows.length;
        typeTotal += rows.length;
        console.log(
          `  upserted ${rows.length} (type ${typeTotal}, run total ${total})`,
        );
      }

      saveProgress(
        emptyProgressFields({
          phase: "names",
          type: typeQid,
          windowStart: maxQid,
          completedTypes: [...completedTypes],
        }),
      );

      windows++;
      await sleep(2500);
    }

    completedTypes.add(typeQid);
    saveProgress(
      emptyProgressFields({
        phase: "names",
        completedTypes: [...completedTypes],
      }),
    );

    const remaining = NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));
    if (remaining.length > 0 && !opts.nameType) {
      console.log(`Next type: ${remaining[0]}`);
    }
  }

  const counts = await countTable(db);
  console.log(
    `Names in DB: ${counts.names}, enrichments: ${counts.enrichments}`,
  );

  if (completedTypes.size === NAME_ENTITY_TYPES.length) {
    console.log("All name types done. Run: pnpm etl:wikidata --edges-only");
    clearProgress();
  }
}

async function ingestNamesWindow(db: Db, opts: Options) {
  let windows = 0;
  let total = 0;

  for (const [minQid, maxQid] of qidWindows(
    opts.qidStart,
    opts.qidEnd,
    opts.windowSize,
  )) {
    if (opts.maxWindows !== null && windows >= opts.maxWindows) break;

    console.log(`Fetching names Q${minQid}–Q${maxQid - 1}…`);
    const result = await runSparql(namesWindowQuery(minQid, maxQid));
    const rows = parseNamesResult(result);
    if (rows.length === 0) {
      windows++;
      await sleep(800);
      continue;
    }

    const qidMap = await upsertNames(db, rows);
    await upsertWikidataDescriptions(db, rows, qidMap);

    total += rows.length;
    windows++;
    console.log(`  upserted ${rows.length} (total ${total})`);
    await sleep(1200);
  }

  const counts = await countTable(db);
  console.log(
    `Names in DB: ${counts.names}, enrichments: ${counts.enrichments}`,
  );
}

async function ingestNamesSearch(db: Db, opts: Options) {
  let total = 0;
  const saved = loadProgress();
  const completedTypes = new Set(saved?.completedTypes ?? []);

  if (
    opts.nameType &&
    completedTypes.has(opts.nameType) &&
    !opts.resume
  ) {
    const remaining = NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));
    console.log(`Type ${opts.nameType} is already complete.`);
    if (remaining.length > 0) {
      console.log(`Continue: pnpm etl:wikidata --names-only --type ${remaining[0]}`);
    } else {
      console.log("All name types done. Run: pnpm etl:wikidata --edges-only");
    }
    return;
  }

  const types = opts.nameType
    ? [opts.nameType]
    : NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));

  if (types.length === 0) {
    console.log("All name types already loaded. Run edges: pnpm etl:wikidata --edges-only");
    return;
  }

  for (const typeQid of types) {
    const gender = genderForNameType(typeQid);
    let typeTotal = 0;
    let pages = 0;

    const totalHits = await getSearchTotalHits(typeQid);
    console.log(`\n── Type ${typeQid} (~${totalHits.toLocaleString()} via search) ──`);

    if (totalHits <= SEARCH_OFFSET_LIMIT) {
      let offset =
        opts.resume && saved?.type === typeQid && saved.searchOffset != null
          ? saved.searchOffset
          : 0;
      let finished = false;

      while (true) {
        if (opts.maxPages !== null && pages >= opts.maxPages) break;

        console.log(`Search ${typeQid} offset=${offset}…`);
        const page = await searchByInstanceOf(typeQid, offset, 50);
        if (page.qids.length === 0) {
          console.log(`  Type ${typeQid} complete (no more results).`);
          finished = true;
          break;
        }

        const rows = await fetchEntitiesAsNames(page.qids, gender);
        if (rows.length > 0) {
          const qidMap = await upsertNames(db, rows);
          await upsertWikidataDescriptions(db, rows, qidMap);
          total += rows.length;
          typeTotal += rows.length;
          console.log(
            `  upserted ${rows.length} (type ${typeTotal}, run total ${total})`,
          );
        }

        const nextOffset = page.nextOffset;
        saveProgress(
          emptyProgressFields({
            phase: "names",
            type: typeQid,
            searchOffset: nextOffset ?? offset + page.qids.length,
            completedTypes: [...completedTypes],
          }),
        );
        console.log(`  resume: pnpm etl:wikidata --names-only --resume`);

        pages++;
        if (nextOffset == null || nextOffset >= SEARCH_OFFSET_LIMIT) {
          console.log(`  Type ${typeQid} complete (${typeTotal} this type).`);
          finished = true;
          break;
        }
        offset = nextOffset;
        await sleep(400);
      }

      if (!finished) {
        console.log(
          `  Stopped early (max-pages). Resume: pnpm etl:wikidata --names-only --resume`,
        );
        break;
      }
    } else {
      // CirrusSearch caps at 10k — shard by URI digit prefix via light SPARQL.
      let pending =
        opts.resume && saved?.type === typeQid && saved.pendingPrefixes.length > 0
          ? [...saved.pendingPrefixes]
          : initialUriPrefixes();

      let uriPrefix =
        opts.resume && saved?.type === typeQid && saved.uriPrefix
          ? saved.uriPrefix
          : pending.shift() ?? null;

      let after =
        opts.resume && saved?.type === typeQid && saved.uriPrefix === uriPrefix
          ? saved.after
          : null;

      console.log(
        `  Using URI-prefix shards (${pending.length + (uriPrefix ? 1 : 0)} remaining) — SPARQL QIDs + MediaWiki labels`,
      );

      let finished = false;
      while (uriPrefix) {
        if (opts.maxPages !== null && pages >= opts.maxPages) break;

        const prefixPageSize = Math.min(opts.pageSize, 200);
        console.log(
          `Prefix Q${uriPrefix}${after ? ` after ${after}` : ""}…`,
        );

        let rawCount = 0;
        let qids: string[] = [];
        try {
          const result = await runSparql(
            namesQidsByUriPrefixQuery(typeQid, uriPrefix, after, prefixPageSize),
            8,
          );
          rawCount = bindingCount(result);
          qids = result.results.bindings
            .map((b) => qidFromUri(b.item?.value ?? ""))
            .filter((q): q is string => q != null);
        } catch (err) {
          if (err instanceof SparqlError && uriPrefix.length < 4) {
            const children = Array.from({ length: 10 }, (_, d) => `${uriPrefix}${d}`);
            console.warn(
              `  Prefix Q${uriPrefix} timed out — splitting into ${children.length} children`,
            );
            pending = [...children, ...pending];
            uriPrefix = pending.shift() ?? null;
            after = null;
            await sleep(3000);
            continue;
          }
          throw err;
        }

        if (qids.length > 0) {
          const rows = await fetchEntitiesAsNames(qids, gender);
          if (rows.length > 0) {
            const qidMap = await upsertNames(db, rows);
            await upsertWikidataDescriptions(db, rows, qidMap);
            total += rows.length;
            typeTotal += rows.length;
            console.log(
              `  upserted ${rows.length} (type ${typeTotal}, run total ${total})`,
            );
          }
          after = maxQid(qids);
        }

        pages++;

        if (rawCount < prefixPageSize) {
          console.log(`  Prefix Q${uriPrefix} done`);
          uriPrefix = pending.shift() ?? null;
          after = null;
        }

        saveProgress(
          emptyProgressFields({
            phase: "names",
            type: typeQid,
            after,
            uriPrefix,
            pendingPrefixes: pending,
            completedTypes: [...completedTypes],
          }),
        );
        console.log(`  resume: pnpm etl:wikidata --names-only --resume`);
        await sleep(800);
      }

      finished = uriPrefix == null;
      if (!finished) {
        console.log(
          `  Stopped early (max-pages). Resume: pnpm etl:wikidata --names-only --resume`,
        );
        break;
      }
      console.log(`  Type ${typeQid} complete (${typeTotal} this type).`);
    }

    completedTypes.add(typeQid);
    saveProgress(
      emptyProgressFields({
        phase: "names",
        completedTypes: [...completedTypes],
      }),
    );

    const remaining = NAME_ENTITY_TYPES.filter((t) => !completedTypes.has(t));
    if (remaining.length > 0 && !opts.nameType) {
      console.log(`Next type: ${remaining[0]}`);
    }
  }

  const counts = await countTable(db);
  console.log(
    `Names in DB: ${counts.names}, enrichments: ${counts.enrichments}`,
  );

  if (completedTypes.size === NAME_ENTITY_TYPES.length) {
    console.log("All name types done. Run: pnpm etl:wikidata --edges-only");
    clearProgress();
  }
}

async function ingestNames(db: Db, opts: Options) {
  if (opts.mode === "search") {
    await ingestNamesSearch(db, opts);
  } else if (opts.mode === "window") {
    await ingestNamesWindow(db, opts);
  } else if (opts.mode === "type-window") {
    await ingestNamesTypeWindow(db, opts);
  } else {
    try {
      await ingestNamesScroll(db, opts);
    } catch (err) {
      if (err instanceof SparqlError) {
        console.warn(
          "Scroll mode timed out — use search mode (default):\n" +
            "  pnpm etl:wikidata --names-only --resume",
        );
      }
      throw err;
    }
  }
}

async function ingestEdgesScroll(db: Db, opts: Options) {
  let offset = opts.scrollOffset;
  let pages = 0;
  const allDirect: RawCognateEdge[] = [];

  while (true) {
    if (opts.maxPages !== null && pages >= opts.maxPages) break;

    console.log(`Fetching P460 edges offset=${offset}…`);
    const result = await runSparql(
      cognateEdgesScrollQuery(offset, opts.pageSize),
    );
    const rawCount = bindingCount(result);
    if (rawCount === 0) break;

    const rows = parseEdgesResult(result);
    if (rows.length > 0) {
      allDirect.push(...rows);
      console.log(`  fetched ${rows.length} (total ${allDirect.length})`);
    }

    pages++;
    offset += opts.pageSize;

    if (rawCount < opts.pageSize) break;
    await sleep(2500);
  }

  await finalizeEdges(db, allDirect, opts);
}

async function ingestEdgesWindow(db: Db, opts: Options) {
  let windows = 0;
  const allDirect: RawCognateEdge[] = [];

  for (const [minQid, maxQid] of qidWindows(
    opts.qidStart,
    opts.qidEnd,
    opts.windowSize,
  )) {
    if (opts.maxWindows !== null && windows >= opts.maxWindows) break;

    console.log(`Fetching P460 edges Q${minQid}–Q${maxQid - 1}…`);
    const result = await runSparql(cognateEdgesWindowQuery(minQid, maxQid));
    const rows = parseEdgesResult(result);
    windows++;

    if (rows.length === 0) {
      await sleep(800);
      continue;
    }

    allDirect.push(...rows);
    console.log(`  fetched ${rows.length} (total ${allDirect.length})`);
    await sleep(1200);
  }

  await finalizeEdges(db, allDirect, opts);
}

async function finalizeEdges(
  db: Db,
  allDirect: RawCognateEdge[],
  opts: Options,
) {
  if (allDirect.length === 0) {
    console.log("No edges fetched.");
    return;
  }

  let edges = allDirect.map((e) => ({ a: e.qidA, b: e.qidB }));
  if (!opts.skipClosure) {
    console.log(`Running closure on ${allDirect.length} direct edges…`);
    const closed = computeClosure(allDirect, MAX_CLOSURE_COMPONENT_SIZE);
    edges = closed.edges;
    if (closed.skippedLargeComponents > 0) {
      console.warn(
        `Skipped full closure for ${closed.skippedLargeComponents} large component(s).`,
      );
    }
    console.log(`Closure produced ${edges.length} edges`);
  }

  const qidMap = await loadQidMap(db);
  console.log(`  ${qidMap.size} names with QIDs in map`);

  const attempted = edges.length;
  await upsertRelations(db, edges, qidMap);
  const counts = await countTable(db);
  console.log(
    `Relations upserted (attempted ${attempted}). DB total: ${counts.relations}`,
  );
}

async function ingestEdgesAdaptiveWindow(db: Db, opts: Options) {
  const saved = loadProgress();
  const allDirect: RawCognateEdge[] = [];
  const queue: Array<[number, number]> = [];
  const initialStart =
    opts.resume && saved?.phase === "edges" && saved.windowStart
      ? saved.windowStart
      : opts.qidStart;

  for (const window of qidWindows(initialStart, opts.qidEnd, opts.windowSize)) {
    queue.push(window);
  }

  let windows = 0;

  while (queue.length > 0) {
    if (opts.maxWindows !== null && windows >= opts.maxWindows) {
      console.log(
        "Stopped early (max-windows). Resume: pnpm etl:wikidata --edges-only --resume",
      );
      break;
    }

    const [minQid, maxQid] = queue.shift()!;
    console.log(`Fetching P460 edges Q${minQid}–Q${maxQid - 1}…`);

    try {
      const result = await runSparql(
        cognateEdgesWindowQuery(minQid, maxQid),
        4,
      );
      const rows = parseEdgesResult(result);
      windows++;

      if (rows.length > 0) {
        allDirect.push(...rows);
        console.log(`  fetched ${rows.length} (total ${allDirect.length})`);
      }

      saveProgress(
        emptyProgressFields({
          phase: "edges",
          windowStart: maxQid,
          completedTypes: saved?.completedTypes ?? [],
        }),
      );
      await sleep(rows.length === 0 ? 800 : 1200);
    } catch (err) {
      if (err instanceof SparqlError && maxQid - minQid > 2_000) {
        const midQid = Math.floor((minQid + maxQid) / 2);
        console.warn(
          `  Window Q${minQid}–Q${maxQid - 1} timed out — splitting into Q${minQid}–Q${midQid - 1} and Q${midQid}–Q${maxQid - 1}`,
        );
        queue.unshift([midQid, maxQid], [minQid, midQid]);
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }

  await finalizeEdges(db, allDirect, opts);
}

async function ingestEdgesKnownQids(db: Db, opts: Options) {
  const saved = loadProgress();
  const qidMap = await loadQidMap(db);
  const allQids = [...qidMap.keys()].sort((a, b) => qidNumeric(a) - qidNumeric(b));
  const batchSize = Math.min(opts.pageSize, 100);
  let offset =
    opts.resume && saved?.phase === "edges" && saved.searchOffset
      ? saved.searchOffset
      : 0;
  const allDirect: RawCognateEdge[] = [];
  let batches = 0;

  console.log(
    `Fetching edges for ${allQids.length.toLocaleString()} known name QIDs in batches of ${batchSize}…`,
  );

  while (offset < allQids.length) {
    if (opts.maxPages !== null && batches >= opts.maxPages) {
      console.log(
        "Stopped early (max-pages). Resume: pnpm etl:wikidata --edges-only --resume",
      );
      break;
    }

    const batch = allQids.slice(offset, offset + batchSize);
    console.log(
      `Fetching P460 edges for QID batch ${offset}–${offset + batch.length - 1}…`,
    );

    const result = await runSparql(cognateEdgesForKnownQidsQuery(batch), 4);
    const rows = parseEdgesResult(result);
    if (rows.length > 0) {
      allDirect.push(...rows);
      console.log(`  fetched ${rows.length} (total ${allDirect.length})`);
    }

    offset += batch.length;
    batches++;
    saveProgress(
      emptyProgressFields({
        phase: "edges",
        searchOffset: offset,
        completedTypes: saved?.completedTypes ?? [],
      }),
    );
    await sleep(rows.length === 0 ? 400 : 800);
  }

  await finalizeEdges(db, allDirect, opts);
}

async function ingestEdges(db: Db, opts: Options) {
  if (opts.mode === "scroll") {
    await ingestEdgesScroll(db, opts);
  } else if (opts.mode === "window") {
    await ingestEdgesWindow(db, opts);
  } else {
    await ingestEdgesKnownQids(db, opts);
  }
}

async function main() {
  const opts = parseArgs();
  console.log("Wikidata ETL", opts);

  const { db, client } = createEtlDb();
  try {
    if (opts.edgesOnly) {
      await ingestEdges(db, opts);
      return;
    }
    if (opts.namesOnly) {
      await ingestNames(db, opts);
      return;
    }

    await ingestNames(db, opts);
    await ingestEdges(db, { ...opts, scrollOffset: 0, maxPages: null });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
