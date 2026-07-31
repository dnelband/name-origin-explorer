-- Additive migration for existing databases (schema.sql already includes these
-- for greenfield installs).

ALTER TABLE names ADD COLUMN IF NOT EXISTS wiktionary_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS names_wiktionary_key_unique
  ON names (wiktionary_key);

CREATE TABLE IF NOT EXISTS name_lineage (
  child_id UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES names(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'derived_from',
  confidence TEXT NOT NULL DEFAULT 'sourced',
  source TEXT NOT NULL DEFAULT 'wiktionary',
  source_url TEXT,
  PRIMARY KEY (child_id, parent_id, relation_type),
  CONSTRAINT name_lineage_no_self CHECK (child_id <> parent_id)
);

CREATE INDEX IF NOT EXISTS idx_name_lineage_parent ON name_lineage (parent_id);
CREATE INDEX IF NOT EXISTS idx_name_lineage_child ON name_lineage (child_id);
