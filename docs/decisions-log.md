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

### Wikidata as name inventory, Wiktionary as lineage, Behind the Name
### as enrichment
Wikidata supplies the cross-lingual **name inventory** and optional P460
cognate edges (`name_relations`). **Directed lineage** for the tree UI
comes from Wiktionary given-name templates (`from=` / `dimof` / `varof`)
loaded into `name_lineage` — P460 is never used as tree ancestry.
Behind the Name supplies richer sourced narrative text where licensed/
available. Using each source for what it actually encodes.

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

### Cognate UI v1 → etymological lineage tree
Force graphs and constellation islands rejected — they fight how people
read names. v1 is a **lineage tree** rooted at the focused name:
ancestors one side, descendants the other (landscape → horizontal;
portrait → vertical). Edges are directed Wiktionary lineage only.

**Landing:** rotate **5** featured etymological roots (many children,
prefer no parents), one tree at a time (~6s). **Search/click:** that name
becomes the new focus and the tree rebuilds. **Shape:** up to **2** hops
each direction, fan-out caps (≤24 nodes). Serif names, bracket lines,
dots, meaning under focus, `1 / 5` featured indicator. Custom SVG/HTML
(not react-flow). No lookalike edges in v1. Empty lineage → focus alone
(no cognate fill-in).

Parked for later: radial tree, language chord/atlas, typographic
constellation, force/constellation experiments.

### Cognate UI — force / constellation (superseded)
Earlier v1 attempt: constellation of islands (20 × ≤7). Abandoned —
graph/node metaphor did not fit the product. See lineage tree decision
above.

### Cognate UI — undirected P460 tree (superseded)
Briefly rooted undirected cognates as a “lineage” tree. Rejected —
visually implied ancestry (e.g. John as child of Gison). Replaced by
Wiktionary-directed lineage.

### Race-condition-testing npm package idea — parked, not part of this
### project
Explored at length as a separate side-project idea (JS/TS race-condition
test harness). Concluded it's feasible and interesting but is its own
project, unrelated to the name-origins app. Not tracked further here.
