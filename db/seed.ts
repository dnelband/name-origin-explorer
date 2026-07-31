import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getDatabaseUrl } from "./env";
import { nameEnrichments, nameLineage, nameRelations, names } from "./schema";

config({ path: ".env.local" });

async function main() {
  const url = getDatabaseUrl("migrate");
  if (!url) {
    throw new Error(
      "No Postgres URL. Set POSTGRES_URL_NON_POOLING in .env.local.",
    );
  }

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  try {
    const existing = await db.select({ id: names.id }).from(names).limit(1);
    if (existing.length > 0) {
      console.log("Names already present — skipping seed.");
      return;
    }

    const [maria, mary, miriam, yusuf, joseph] = await db
      .insert(names)
      .values([
        {
          label: "Maria",
          nativeLabel: "Μαρία",
          language: "Greek",
          gender: "female",
          wikidataQid: "Q325872",
        },
        {
          label: "Mary",
          language: "English",
          gender: "female",
        },
        {
          label: "Miriam",
          nativeLabel: "מִרְיָם",
          language: "Hebrew",
          gender: "female",
        },
        {
          label: "Yusuf",
          nativeLabel: "يوسف",
          language: "Arabic",
          gender: "male",
        },
        {
          label: "Joseph",
          language: "English",
          gender: "male",
        },
      ])
      .returning();

    await db.insert(nameEnrichments).values([
      {
        nameId: maria.id,
        source: "behindthename",
        field: "meaning",
        content:
          "Latin form of Mary / Maria, ultimately from Hebrew Miriam. Exact meaning uncertain; often linked to 'bitter', 'beloved', or 'rebellious'.",
        sourceUrl: "https://www.behindthename.com/name/maria",
      },
      {
        nameId: joseph.id,
        source: "behindthename",
        field: "etymology",
        content:
          "From Latin Ioseph, from Greek Ioseph, from Hebrew Yosef meaning 'he will add'.",
        sourceUrl: "https://www.behindthename.com/name/joseph",
      },
    ]);

    const pair = (a: string, b: string) =>
      a < b ? { nameA: a, nameB: b } : { nameA: b, nameB: a };

    await db.insert(nameRelations).values([
      {
        ...pair(maria.id, mary.id),
        relationType: "cognate",
        confidence: "community",
      },
      {
        ...pair(maria.id, miriam.id),
        relationType: "cognate",
        confidence: "community",
      },
      {
        ...pair(mary.id, miriam.id),
        relationType: "cognate",
        confidence: "community",
      },
      {
        ...pair(yusuf.id, joseph.id),
        relationType: "cognate",
        confidence: "community",
      },
    ]);

    // Directed lineage (Wiktionary-style): Mary ← Maria ← Miriam
    await db.insert(nameLineage).values([
      {
        childId: maria.id,
        parentId: miriam.id,
        relationType: "derived_from",
        confidence: "sourced",
        source: "wiktionary",
        sourceUrl: "https://en.wiktionary.org/wiki/Maria",
      },
      {
        childId: mary.id,
        parentId: maria.id,
        relationType: "derived_from",
        confidence: "sourced",
        source: "wiktionary",
        sourceUrl: "https://en.wiktionary.org/wiki/Mary",
      },
    ]);

    console.log("Seeded sample names: Maria, Mary, Miriam, Yusuf, Joseph.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
