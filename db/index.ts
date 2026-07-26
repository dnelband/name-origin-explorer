import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "./env";
import * as schema from "./schema";

const connectionString = getDatabaseUrl("runtime");

const client = connectionString
  ? postgres(connectionString, { prepare: false, max: 10 })
  : null;

export const db = client ? drizzle(client, { schema }) : null;

export function requireDb() {
  if (!db) {
    throw new Error(
      "No Postgres URL found. Set POSTGRES_URL (or DATABASE_URL) in .env.local.",
    );
  }
  return db;
}
