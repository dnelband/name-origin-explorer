import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./db/env";

config({ path: ".env.local" });

const url = getDatabaseUrl("migrate");

if (!url) {
  throw new Error(
    "No Postgres URL for migrations. Set POSTGRES_URL_NON_POOLING in .env.local.",
  );
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
