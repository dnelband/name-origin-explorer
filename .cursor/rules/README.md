# Name Origins — Project Ruleset

Cursor project rules for the name-origins app. Planning output covering
concept, data sourcing, cultural scope, stack, and schema.

## Structure

```
.cursor/rules/
  project-overview.mdc      always — what this app is/isn't
  stack.mdc                 always — framework/tooling + hard constraints
  cultural-scope.mdc        file-scoped — MVP tradition boundaries
  data-sources.mdc          file-scoped — Wikidata + Behind the Name ETL
  schema-conventions.mdc    file-scoped — schema / Drizzle conventions

docs/
  decisions-log.md          settled decisions + reasoning
  open-questions.md         undecided items — do not treat as settled

db/
  schema.sql                first-pass Postgres schema (draft)
```

## How to use this

- `.mdc` files are Cursor project rules. Frontmatter (`alwaysApply`,
  `globs`, `description`) controls when they load.
- `docs/` files are reference, not rules — check before re-litigating a
  decision or quietly answering an open question.
- `db/schema.sql` is a starting point to iterate on locally, then migrate
  into Drizzle when scaffolding the app.

## Deferred rules

Add these when the codebase exists — not before:

- Next.js / App Router conventions
- UI / visual direction (mockups first per design workflow)
