import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

const client = connectionString
  ? postgres(connectionString, { prepare: false, max: 10 })
  : null;

export const db = client ? drizzle(client, { schema }) : null;

export function requireDb() {
  if (!db) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local to enable database reads.",
    );
  }
  return db;
}
