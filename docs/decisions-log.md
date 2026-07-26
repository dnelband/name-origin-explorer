# Decisions Log

Settled decisions, with the reasoning, so a future session (you or an
agent) doesn't re-litigate these from scratch. If you want to revisit one,
that's fine — but do it deliberately, not by accident.

### Aggregation, not a wrapper
Rejected a "just build a UI over Behind the Name's data" scope. The point
of the project is the aggregation/enrichment layer itself (Wikidata as
graph backbone + Behind the Name enrichment), not reformatting one
existing dataset.

### MVP cultural scope is bounded deliberately
Compositional (Chinese/Japanese/Korean) and circumstantial (e.g. Akan,
Yoruba) naming traditions are excluded from MVP — not due to a Western
bias in intent, but because they don't fit the etymological data model and
forcing them in would misrepresent them. Full reasoning in
`.cursor/rules/cultural-scope.mdc`. Revisit as a proper v2 with its own
data model, not a patch to the current schema.

### Wikidata as backbone, Behind the Name as enrichment (not two
### competing sources)
Wikidata gives the cross-lingual graph structure (via P460 cognate links)
at genuinely global scope; Behind the Name gives richer sourced narrative
text where it has coverage. Using them for what each is actually good at,
rather than picking one or awkwardly merging both for everything.

### Broad-batch ingestion via cron, not on-demand
Considered on-demand/grow-with-usage. Rejected because: storage is cheap
at this data scale (~30-100MB estimate, non-issue), on-demand means poor
first-search latency and rate-limit exposure, and the graph view needs to
already be populated to be useful. See `.cursor/rules/data-sources.mdc`.

### pg_trgm over a dedicated search service
Typesense/Meilisearch would give nicer typo-tolerant search UX, but are
unjustified infrastructure for MVP scale. Postgres's own trigram search is
"good enough," and upgrading later is a contained change if it's ever
actually needed.

### Fonts: Inter + selective Noto, not all-Noto
Loading every Noto script family is unnecessary weight. Inter covers the
common case (Latin/Greek/Cyrillic); Noto script-specific families are
loaded only for scripts Inter doesn't cover (Hebrew, Arabic, Devanagari).

### Race-condition-testing npm package idea — parked, not part of this
### project
Explored at length as a separate side-project idea (JS/TS race-condition
test harness). Concluded it's feasible and interesting but is its own
project, unrelated to the name-origins app. Not tracked further here.
