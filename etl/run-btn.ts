import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { nameEnrichments, names } from "@/db/schema";
import { BtnClient } from "./btn/client";
import { createEtlDb } from "./shared/db";

config({ path: ".env.local" });

const DAILY_CAP = 4000;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    limit: Number(get("--limit") ?? DAILY_CAP),
    minDegree: Number(get("--min-degree") ?? 0),
  };
}

async function main() {
  const apiKey = process.env.BTN_API_KEY;
  if (!apiKey) {
    throw new Error("BTN_API_KEY is required in .env.local");
  }

  const { limit, minDegree } = parseArgs();
  const { db, client: pgClient } = createEtlDb();
  const btn = new BtnClient(apiKey);

  try {
    const degreeSql = sql<number>`(
      SELECT COUNT(*)::int FROM name_relations nr
      WHERE nr.name_a = ${names.id} OR nr.name_b = ${names.id}
    )`;

    const candidates = await db
      .select({
        id: names.id,
        label: names.label,
        degree: degreeSql,
      })
      .from(names)
      .where(sql`${names.wikidataQid} IS NOT NULL`)
      .orderBy(sql`(
        SELECT COUNT(*)::int FROM name_relations nr
        WHERE nr.name_a = ${names.id} OR nr.name_b = ${names.id}
      ) DESC`)
      .limit(limit * 2);

    const already = await db
      .select({ nameId: nameEnrichments.nameId })
      .from(nameEnrichments)
      .where(sql`${nameEnrichments.source} = 'behindthename'`);
    const done = new Set(already.map((r) => r.nameId));

    const pending = candidates
      .filter((c) => c.degree >= minDegree && !done.has(c.id))
      .slice(0, limit);

    console.log(
      `BTN enrichment: ${pending.length} names (${done.size} already have BTN; cap ${limit})`,
    );
    console.log(
      "Note: BTN API provides gender/usages/related — not meaning text.",
    );

    let enriched = 0;

    for (const row of pending) {
      const lookup = await btn.lookup(row.label);
      if (lookup?.usages.length) {
        await db
          .insert(nameEnrichments)
          .values({
            nameId: row.id,
            source: "behindthename",
            field: "usage",
            content: `Usages: ${lookup.usages.join(", ")}`,
            sourceUrl: lookup.sourceUrl,
          })
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

      const related = await btn.related(row.label);
      if (related?.related.length) {
        await db
          .insert(nameEnrichments)
          .values({
            nameId: row.id,
            source: "behindthename",
            field: "related",
            content: related.related.slice(0, 30).join(", "),
            sourceUrl: related.sourceUrl,
          })
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

      enriched++;
      if (enriched % 50 === 0) {
        console.log(`  enriched ${enriched}/${pending.length}`);
      }
    }

    console.log(`Done. Enriched ${enriched} names.`);
  } finally {
    await pgClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
