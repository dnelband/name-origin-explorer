import { eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { nameLineage, names } from "@/db/schema";
import { chunk } from "../shared/db";
import type {
  TransformResult,
  WiktionaryLineageEdge,
  WiktionaryNameRow,
} from "./transform";

type Db = PostgresJsDatabase<typeof import("@/db/schema")>;

const INSERT_CHUNK = 400;

function languageFromCode(code: string): string | null {
  const map: Record<string, string> = {
    en: "English",
    fr: "French",
    de: "German",
    es: "Spanish",
    it: "Italian",
    pt: "Portuguese",
    nl: "Dutch",
    sv: "Swedish",
    no: "Norwegian",
    da: "Danish",
    fi: "Finnish",
    ga: "Irish",
    cy: "Welsh",
    pl: "Polish",
    cs: "Czech",
    ru: "Russian",
    el: "Greek",
    grc: "Ancient Greek",
    la: "Latin",
    he: "Hebrew",
    hbo: "Biblical Hebrew",
    ar: "Arabic",
    ja: "Japanese",
    zh: "Chinese",
    sa: "Sanskrit",
    ang: "Old English",
    non: "Old Norse",
  };
  return map[code.toLowerCase()] ?? null;
}

/** Upsert names by wiktionary_key. */
export async function upsertWiktionaryNames(
  db: Db,
  rows: WiktionaryNameRow[],
): Promise<void> {
  if (rows.length === 0) return;

  for (const batch of chunk(rows, INSERT_CHUNK)) {
    await db
      .insert(names)
      .values(
        batch.map((row) => ({
          wiktionaryKey: row.key,
          label: row.label,
          language: row.language ?? languageFromCode(row.langCode),
          gender: row.gender,
          traditionType: "etymological" as const,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: names.wiktionaryKey,
        set: {
          label: sql`excluded.label`,
          language: sql`COALESCE(excluded.language, ${names.language})`,
          gender: sql`COALESCE(excluded.gender, ${names.gender})`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Resolve keys → ids from DB after upsert. */
export async function resolveKeyMap(
  db: Db,
  keys: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const batch of chunk([...new Set(keys)], INSERT_CHUNK)) {
    const found = await db
      .select({ id: names.id, key: names.wiktionaryKey })
      .from(names)
      .where(inArray(names.wiktionaryKey, batch));
    for (const row of found) {
      if (row.key) map.set(row.key, row.id);
    }
  }
  return map;
}

export async function replaceLineageEdges(
  db: Db,
  edges: WiktionaryLineageEdge[],
  keyToId: Map<string, string>,
) {
  await db.delete(nameLineage).where(eq(nameLineage.source, "wiktionary"));

  const values = edges
    .map((edge) => {
      const childId = keyToId.get(edge.childKey);
      const parentId = keyToId.get(edge.parentKey);
      if (!childId || !parentId || childId === parentId) return null;
      return {
        childId,
        parentId,
        relationType: edge.relationType,
        confidence: "sourced" as const,
        source: "wiktionary" as const,
        sourceUrl: edge.sourceUrl,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  let written = 0;
  for (const batch of chunk(values, INSERT_CHUNK)) {
    if (batch.length === 0) continue;
    await db.insert(nameLineage).values(batch).onConflictDoNothing();
    written += batch.length;
  }
  return written;
}

export async function loadWiktionaryLineage(
  db: Db,
  data: TransformResult,
): Promise<{ names: number; edges: number }> {
  await upsertWiktionaryNames(db, data.names);
  const keyToId = await resolveKeyMap(
    db,
    data.names.map((n) => n.key),
  );
  const edges = await replaceLineageEdges(db, data.edges, keyToId);
  return { names: keyToId.size, edges };
}
