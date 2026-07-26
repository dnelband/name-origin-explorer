import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { getDatabaseUrl } from "./env";

config({ path: ".env.local" });

async function main() {
  const url = getDatabaseUrl("migrate");
  if (!url) {
    throw new Error(
      "No Postgres URL. Set POSTGRES_URL_NON_POOLING in .env.local.",
    );
  }

  const sqlPath = resolve(process.cwd(), "db/schema.sql");
  const sqlText = readFileSync(sqlPath, "utf8");

  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await client.unsafe(sqlText);
    console.log("Applied db/schema.sql successfully.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
