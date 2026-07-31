-- Name Origins App — first-pass schema
-- Not final. Treat as a starting point to run locally and iterate on.
-- See .cursor/rules/cultural-scope.mdc, data-sources.mdc, and
-- schema-conventions.mdc for the reasoning behind specific columns.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- Core name entity
CREATE TABLE names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wikidata_qid TEXT UNIQUE,        -- e.g. "Q325872"; null if sourced elsewhere later
  wiktionary_key TEXT UNIQUE,      -- e.g. "en:edward"; stable Wiktionary rematch
  label TEXT NOT NULL,             -- display form, e.g. "Maria"
  native_label TEXT,               -- original script, e.g. "Мария"
  language TEXT,                   -- from Wikidata P407 / Behind the Name usage tag
  gender TEXT,                     -- male / female / unisex

  -- Exists now so future non-etymological traditions (compositional,
  -- circumstantial) are additive, not a breaking migration.
  -- See .cursor/rules/cultural-scope.mdc before changing this default
  -- or adding logic that assumes 'etymological' is the only value.
  tradition_type TEXT NOT NULL DEFAULT 'etymological',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_names_label_trgm ON names USING gin (label gin_trgm_ops);
CREATE INDEX idx_names_tradition_type ON names (tradition_type);

-- Enrichment text, per source, per name — keeps attribution explicit.
-- A name can have multiple rows here (one per source, one per field),
-- e.g. (Wikidata, 'etymology') and (Behind the Name, 'history') separately.
CREATE TABLE name_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_id UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  source TEXT NOT NULL,            -- 'wikidata' | 'behindthename'
  field TEXT NOT NULL,             -- 'meaning' | 'history' | 'etymology'
  content TEXT NOT NULL,
  source_url TEXT,                 -- for attribution links in the UI
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name_id, source, field)
);

-- Cognate graph edges, POST-closure only.
-- ETL must run BFS/union-find over raw Wikidata P460 edges before writing
-- here. The app should never need to compute graph closure at query time.
CREATE TABLE name_relations (
  name_a UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  name_b UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'cognate',
  -- 'community' = derived from Wikidata P460 (informally justified per
  -- Wikidata's own editors, not strictly sourced).
  -- 'sourced' = corroborated by Behind the Name or similar.
  confidence TEXT NOT NULL DEFAULT 'community',

  PRIMARY KEY (name_a, name_b),
  CONSTRAINT name_relations_ordered CHECK (name_a < name_b)
  -- ^ Enforces canonical ordering to prevent duplicate edges stored in
  -- both directions. ETL write path must sort the pair before insert,
  -- e.g.: const [a, b] = [idA, idB].sort()
);

CREATE INDEX idx_name_relations_b ON name_relations (name_b);

-- Directed etymological lineage from Wiktionary (not P460 cognates).
-- child is derived from / diminutive of / variant of parent.
CREATE TABLE name_lineage (
  child_id UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  -- 'derived_from' | 'diminutive_of' | 'variant_of'
  relation_type TEXT NOT NULL DEFAULT 'derived_from',
  confidence TEXT NOT NULL DEFAULT 'sourced',
  source TEXT NOT NULL DEFAULT 'wiktionary',
  source_url TEXT,
  PRIMARY KEY (child_id, parent_id, relation_type),
  CONSTRAINT name_lineage_no_self CHECK (child_id <> parent_id)
);

CREATE INDEX idx_name_lineage_parent ON name_lineage (parent_id);
CREATE INDEX idx_name_lineage_child ON name_lineage (child_id);
