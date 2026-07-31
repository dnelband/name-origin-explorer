import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "@/db/env";
import * as schema from "@/db/schema";

export function createEtlDb() {
  const url = getDatabaseUrl("migrate");
  if (!url) {
    throw new Error(
      "No Postgres URL for ETL. Set POSTGRES_URL_NON_POOLING in .env.local.",
    );
  }

  const client = postgres(url, { prepare: false, max: 5 });
  return { db: drizzle(client, { schema }), client };
}

/** Extract QID from a Wikidata entity URI, or null for lexemes (L…) / junk. */
export function qidFromUri(uri: string): string | null {
  const match = uri.match(/(Q\d+)$/);
  return match ? match[1] : null;
}

export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
