import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const names = pgTable(
  "names",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wikidataQid: text("wikidata_qid").unique(),
    /** Stable Wiktionary rematch key, e.g. "en:edward". */
    wiktionaryKey: text("wiktionary_key").unique(),
    label: text("label").notNull(),
    nativeLabel: text("native_label"),
    language: text("language"),
    gender: text("gender"),
    traditionType: text("tradition_type").notNull().default("etymological"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_names_tradition_type").on(table.traditionType)],
);

export const nameEnrichments = pgTable(
  "name_enrichments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nameId: uuid("name_id")
      .notNull()
      .references(() => names.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    field: text("field").notNull(),
    content: text("content").notNull(),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("name_enrichments_name_id_source_field_unique").on(
      table.nameId,
      table.source,
      table.field,
    ),
  ],
);

export const nameRelations = pgTable(
  "name_relations",
  {
    nameA: uuid("name_a")
      .notNull()
      .references(() => names.id, { onDelete: "cascade" }),
    nameB: uuid("name_b")
      .notNull()
      .references(() => names.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("cognate"),
    confidence: text("confidence").notNull().default("community"),
  },
  (table) => [
    primaryKey({ columns: [table.nameA, table.nameB] }),
    check("name_relations_ordered", sql`${table.nameA} < ${table.nameB}`),
    index("idx_name_relations_b").on(table.nameB),
  ],
);

/** Directed etymological lineage (Wiktionary). child ← derived from ← parent. */
export const nameLineage = pgTable(
  "name_lineage",
  {
    childId: uuid("child_id")
      .notNull()
      .references(() => names.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => names.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("derived_from"),
    confidence: text("confidence").notNull().default("sourced"),
    source: text("source").notNull().default("wiktionary"),
    sourceUrl: text("source_url"),
  },
  (table) => [
    primaryKey({
      columns: [table.childId, table.parentId, table.relationType],
    }),
    check(
      "name_lineage_no_self",
      sql`${table.childId} <> ${table.parentId}`,
    ),
    index("idx_name_lineage_parent").on(table.parentId),
    index("idx_name_lineage_child").on(table.childId),
  ],
);

export type Name = typeof names.$inferSelect;
export type NameEnrichment = typeof nameEnrichments.$inferSelect;
export type NameRelation = typeof nameRelations.$inferSelect;
export type NameLineage = typeof nameLineage.$inferSelect;
