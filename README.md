# Name Origins

Etymology and cross-language cognate explorer. Data is aggregated from
Wikidata (graph) and Behind the Name (enrichment) into Postgres — the app
only reads our database.

## Stack

- Next.js 16 (App Router)
- Postgres via Supabase
- Drizzle ORM
- `pg_trgm` search
- Vercel hosting

## Setup

```bash
pnpm install
cp .env.example .env.local
# set DATABASE_URL to your Supabase Postgres connection string
```

Apply the first-pass SQL (extensions + tables + trigram index) once:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Then:

```bash
pnpm dev
```

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Local Next.js server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate Drizzle migrations from `db/schema.ts` |
| `pnpm db:push` | Push Drizzle schema to the database |
| `pnpm db:studio` | Drizzle Studio |

## Project notes

- Product/scope rules: `.cursor/rules/`
- Settled decisions: `docs/decisions-log.md`
- Open questions (do not invent answers): `docs/open-questions.md`
- ETL / cognate graph UX are deferred until those open questions are settled
