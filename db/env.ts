/**
 * Resolve Postgres URL from Vercel ↔ Supabase integration env vars.
 * Runtime prefers the pooler; migrations prefer the direct (non-pooling) URL.
 */
export function getDatabaseUrl(kind: "runtime" | "migrate" = "runtime"): string | undefined {
  if (kind === "migrate") {
    return (
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL
    );
  }

  return (
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}
