import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { nameEnrichments, nameRelations, names } from "@/db/schema";
import { canonicalPair, chunk } from "../shared/db";
import type { ClosureEdge } from "./closure";
import type { RawWikidataName } from "./transform";

type Db = PostgresJsDatabase<typeof import("@/db/schema")>;

const INSERT_CHUNK = 500;

export async function upsertNames(
  db: Db,
  rows: RawWikidataName[],
): Promise<Map<string, string>> {
  const qidToId = new Map<string, string>();

  for (const batch of chunk(rows, INSERT_CHUNK)) {
    if (batch.length === 0) continue;

    const inserted = await db
      .insert(names)
      .values(
        batch.map((row) => ({
          wikidataQid: row.qid,
          label: row.label,
          nativeLabel: row.nativeLabel,
          language: row.language,
          gender: row.gender,
          traditionType: "etymological" as const,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: names.wikidataQid,
        set: {
          label: sql`excluded.label`,
          nativeLabel: sql`excluded.native_label`,
          language: sql`excluded.language`,
          gender: sql`excluded.gender`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: names.id, qid: names.wikidataQid });

    for (const row of inserted) {
      if (row.qid) qidToId.set(row.qid, row.id);
    }
  }

  return qidToId;
}

export async function upsertWikidataDescriptions(
  db: Db,
  rows: RawWikidataName[],
  qidToId: Map<string, string>,
) {
  const enrichments = rows
    .filter((row) => row.description && qidToId.has(row.qid))
    .map((row) => ({
      nameId: qidToId.get(row.qid)!,
      source: "wikidata",
      field: "description",
      content: row.description!,
      sourceUrl: `https://www.wikidata.org/wiki/${row.qid}`,
    }));

  for (const batch of chunk(enrichments, INSERT_CHUNK)) {
    await db
      .insert(nameEnrichments)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          nameEnrichments.nameId,
          nameEnrichments.source,
          nameEnrichments.field,
        ],
        set: {
          content: sql`excluded.content`,
          sourceUrl: sql`excluded.source_url`,
          fetchedAt: sql`now()`,
        },
      });
  }
}

export async function loadQidMap(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: names.id, qid: names.wikidataQid })
    .from(names)
    .where(sql`${names.wikidataQid} IS NOT NULL`);

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.qid) map.set(row.qid, row.id);
  }
  return map;
}

export async function upsertRelations(
  db: Db,
  edges: ClosureEdge[],
  qidToId: Map<string, string>,
) {
  const values = edges
    .map((edge) => {
      const idA = qidToId.get(edge.a);
      const idB = qidToId.get(edge.b);
      if (!idA || !idB) return null;
      const [nameA, nameB] = canonicalPair(idA, idB);
      return {
        nameA,
        nameB,
        relationType: "cognate" as const,
        confidence: "community" as const,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (const batch of chunk(values, INSERT_CHUNK)) {
    await db
      .insert(nameRelations)
      .values(batch)
      .onConflictDoNothing();
  }
}

export async function countTable(db: Db): Promise<{
  names: number;
  relations: number;
  enrichments: number;
}> {
  const [nameCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(names);
  const [relationCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nameRelations);
  const [enrichmentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nameEnrichments);

  return {
    names: nameCount?.count ?? 0,
    relations: relationCount?.count ?? 0,
    enrichments: enrichmentCount?.count ?? 0,
  };
}
