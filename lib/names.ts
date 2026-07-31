import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
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

export type SearchNamesOptions = {
  language?: string | null;
  page?: number;
  pageSize?: number;
  /** Collapse duplicate labels (suggestions). Off for full search pages. */
  dedupeLabels?: boolean;
};

export type SearchNamesPage = {
  results: NameSearchResult[];
  total: number;
  page: number;
  pageSize: number;
};

function dedupeByLabel<T extends { label: string }>(rows: T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = row.label.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function searchWhere(q: string, language?: string | null) {
  const match = or(
    sql`${names.label} % ${q}`,
    sql`${names.label} ILIKE ${"%" + q + "%"}`,
  );
  if (language?.trim()) {
    return and(match, sql`${names.language} ILIKE ${language.trim()}`);
  }
  return match;
}

/**
 * Full paginated search. Use `dedupeLabels: true` for typeahead suggestions.
 */
export async function searchNames(
  query: string,
  options: SearchNamesOptions = {},
): Promise<SearchNamesPage> {
  const q = query.trim();
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 50);
  const page = Math.max(options.page ?? 1, 1);
  const language = options.language?.trim() || null;
  const dedupe = options.dedupeLabels ?? false;

  if (!q || !db) {
    return { results: [], total: 0, page, pageSize };
  }

  const database = requireDb();
  const where = searchWhere(q, language);

  const [countRow] = await database
    .select({
      n: sql<number>`count(*)::int`,
    })
    .from(names)
    .where(where);

  const total = countRow?.n ?? 0;
  const fetchLimit = dedupe ? Math.min(pageSize * 5, 60) : pageSize;
  const offset = dedupe ? 0 : (page - 1) * pageSize;

  const rows = await database
    .select({
      id: names.id,
      label: names.label,
      nativeLabel: names.nativeLabel,
      language: names.language,
      gender: names.gender,
    })
    .from(names)
    .where(where)
    .orderBy(
      sql`similarity(${names.label}, ${q}) DESC`,
      sql`(
        SELECT COUNT(*)::int FROM name_lineage nl
        WHERE nl.child_id = ${names.id} OR nl.parent_id = ${names.id}
      ) DESC`,
      sql`(${names.wiktionaryKey} IS NOT NULL) DESC`,
      sql`(${names.language} ILIKE 'english') DESC`,
      sql`(
        SELECT COUNT(*)::int FROM ${nameRelations}
        WHERE ${nameRelations.nameA} = ${names.id}
           OR ${nameRelations.nameB} = ${names.id}
      ) DESC`,
    )
    .limit(fetchLimit)
    .offset(offset);

  const results = dedupe ? dedupeByLabel(rows, pageSize) : rows;

  return {
    results,
    total: dedupe ? results.length : total,
    page,
    pageSize,
  };
}

/** Distinct languages present in the catalog, most common first. */
export async function listNameLanguages(limit = 80): Promise<string[]> {
  if (!db) return [];
  const database = requireDb();
  const rows = await database
    .select({
      language: names.language,
      n: sql<number>`count(*)::int`,
    })
    .from(names)
    .where(isNotNull(names.language))
    .groupBy(names.language)
    .orderBy(sql`count(*) DESC`, names.language)
    .limit(limit);

  return rows
    .map((r) => r.language)
    .filter((l): l is string => Boolean(l?.trim()));
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
