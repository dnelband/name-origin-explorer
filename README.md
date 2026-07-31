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
# Paste Vercel ↔ Supabase env vars into .env.local (POSTGRES_URL, etc.)
```

Apply the first-pass SQL (extensions + tables + trigram index) once:

```bash
pnpm db:bootstrap
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
| `pnpm db:bootstrap` | Apply `db/schema.sql` (extensions + tables) |
| `pnpm db:seed` | Insert a few sample names for local smoke tests |
| `pnpm db:generate` | Generate Drizzle migrations from `db/schema.ts` |
| `pnpm db:push` | Push Drizzle schema to the database |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm etl:wikidata` | Bulk load names + P460 cognates from Wikidata |
| `pnpm etl:wiktionary` | Load directed lineage from Wiktionary (kaikki dump) |
| `pnpm etl:btn` | Enrich top names via Behind the Name API |
| `pnpm test:etl` | Unit tests for ETL transform/closure |

## Data loading

Wikidata is the main source for **name inventory** and undirected P460
cognate edges (`name_relations`). The **lineage tree** uses directed edges
from Wiktionary (`name_lineage`) only — not P460.

### Wiktionary lineage

Stream a Wiktextract dump (from [kaikki.org](https://kaikki.org/dictionary/rawdata.html))
and extract given-name `from=` / `dimof` / `varof` chains:

```bash
# Existing DB: apply additive migration once
psql "$POSTGRES_URL_NON_POOLING" -f db/migrations/001_name_lineage.sql

# Smoke with fixture (no download)
pnpm etl:wiktionary --fixture

# Full dump (large ~2.6GB gz) — downloads to data/
pnpm etl:wiktionary --download
```

### Wikidata

Names default to **search mode**: MediaWiki CirrusSearch (`haswbstatement:P31=…`) +
`wbgetentities` for labels. Types with >10k hits are sharded by URI prefix
via light SPARQL (QIDs only). Edge loading batches over the known name QIDs
already loaded in Postgres, which avoids broad Wikidata graph scans and
resumes from progress. Progress is saved to `.etl-wikidata-progress.json`.

```bash
# Resume / continue remaining types (default: --mode search)
pnpm etl:wikidata --names-only --resume

# Then load edges
pnpm etl:wikidata --edges-only

# Resume edge loading after interrupt / timeout
pnpm etl:wikidata --edges-only --resume
```

Behind the Name API (rate-limited — max ~4000/day). Provides usages and
related names, not meaning/history text:

```bash
pnpm etl:btn --limit 500
```

## Project notes

- Product/scope rules: `.cursor/rules/`
- Settled decisions: `docs/decisions-log.md`
- Open questions (do not invent answers): `docs/open-questions.md`
