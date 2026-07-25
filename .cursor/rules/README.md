# Name Origins App — Project Ruleset

This folder is the planning/ruleset output for the name-origins app,
produced from a scoping conversation covering concept, data sourcing,
cultural scope, stack, and schema. Drop the `.cursor/rules/` folder into
your project root as-is — Cursor will pick the rules up automatically.

## Structure

```
.cursor/rules/
  01-project-overview.mdc     concept, what this app is/isn't
  02-cultural-scope.mdc       MVP scope boundaries + reasoning (read first)
  03-data-sources.mdc         Wikidata + Behind the Name, properties, licensing
  04-stack-and-conventions.mdc  framework/tooling choices + why
db/
  schema.sql                  first-pass Postgres schema
docs/
  open-questions.md           genuinely undecided items — don't treat as settled
  decisions-log.md            settled decisions with the reasoning, for future you
```

## How to use this

- The `.mdc` files are written to be Cursor project rules — each has
  frontmatter (`alwaysApply`, `description`) so Cursor loads the right
  context automatically rather than you having to paste this into every
  prompt.
- `docs/decisions-log.md` and `docs/open-questions.md` are plain docs, not
  rules — useful for you (or an agent) to check "was this already decided,
  and why" before re-litigating something mid-build.
- `db/schema.sql` is a first pass, not final — treat it as a starting point
  to run against a local Postgres instance and iterate on.
