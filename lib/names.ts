import { eq, inArray, or, sql } from "drizzle-orm";
import { db, requireDb } from "@/db";
import {
  nameEnrichments,
  nameRelations,
  names,
  type Name,
  type NameEnrichment,
} from "@/db/schema";

export type NameSearchResult = Pick<
  Name,
  "id" | "label" | "nativeLabel" | "language" | "gender"
>;

export type NameDetail = {
  name: Name;
  enrichments: NameEnrichment[];
  cognates: NameSearchResult[];
};

export async function searchNames(query: string): Promise<NameSearchResult[]> {
  const q = query.trim();
  if (!q || !db) return [];

  const database = requireDb();

  return database
    .select({
      id: names.id,
      label: names.label,
      nativeLabel: names.nativeLabel,
      language: names.language,
      gender: names.gender,
    })
    .from(names)
    .where(
      or(
        sql`${names.label} % ${q}`,
        sql`${names.label} ILIKE ${"%" + q + "%"}`,
      ),
    )
    .orderBy(sql`similarity(${names.label}, ${q}) DESC`)
    .limit(20);
}

export async function getNameDetail(id: string): Promise<NameDetail | null> {
  if (!db) return null;

  const database = requireDb();

  const [name] = await database
    .select()
    .from(names)
    .where(eq(names.id, id))
    .limit(1);

  if (!name) return null;

  const enrichments = await database
    .select()
    .from(nameEnrichments)
    .where(eq(nameEnrichments.nameId, id));

  const edges = await database
    .select({
      nameA: nameRelations.nameA,
      nameB: nameRelations.nameB,
    })
    .from(nameRelations)
    .where(or(eq(nameRelations.nameA, id), eq(nameRelations.nameB, id)));

  const cognateIds = edges.map((edge) =>
    edge.nameA === id ? edge.nameB : edge.nameA,
  );

  const cognates =
    cognateIds.length === 0
      ? []
      : await database
          .select({
            id: names.id,
            label: names.label,
            nativeLabel: names.nativeLabel,
            language: names.language,
            gender: names.gender,
          })
          .from(names)
          .where(inArray(names.id, cognateIds))
          .limit(50);

  return { name, enrichments, cognates };
}
