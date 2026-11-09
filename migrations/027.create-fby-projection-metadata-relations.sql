START TRANSACTION;

ALTER TABLE fby_projection ADD COLUMN root_entity_id INTEGER REFERENCES fby_entity (id);
ALTER TABLE fby_projection ADD COLUMN page_size INTEGER;
ALTER TABLE fby_projection ADD COLUMN page_max INTEGER;
ALTER TABLE fby_projection ADD COLUMN dropped_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE fby_projection_parameter (
  projection_id INTEGER REFERENCES fby_projection (id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  field TEXT NOT NULL,
  match TEXT NOT NULL,
  PRIMARY KEY (projection_id, position),
  CONSTRAINT uniq_fby_projection_parameter_projection_id_name UNIQUE (projection_id, name),
  CONSTRAINT chk_fby_projection_parameter_match CHECK (match IN ('equals', 'prefix', 'in', 'range'))
);

CREATE TABLE fby_projection_order (
  projection_id INTEGER REFERENCES fby_projection (id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  field TEXT NOT NULL,
  direction TEXT NOT NULL,
  nulls TEXT,
  PRIMARY KEY (projection_id, position),
  CONSTRAINT chk_fby_projection_order_direction CHECK (direction IN ('ASC', 'DESC')),
  CONSTRAINT chk_fby_projection_order_nulls CHECK (nulls IN ('FIRST', 'LAST'))
);

CREATE OR REPLACE FUNCTION fby_entity_field_hint(p_entity_id INTEGER) RETURNS TEXT
AS $$
  SELECT '; existing fields are ' || string_agg('''' || COALESCE(given_name, name) || '''', ', ' ORDER BY position)
  FROM fby_entity_field
  WHERE entity_id = p_entity_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fby_projection_hint(p_name TEXT, p_version INTEGER) RETURNS TEXT
AS $$
  SELECT COALESCE(
    (SELECT '; did you mean ' || string_agg('''' || name || ' v' || version || '''', ', ' ORDER BY name) || '?' FROM fby_projection WHERE lower(name) = lower(p_name) AND version = p_version AND dropped_at IS NULL),
    (SELECT '; existing projections are ' || string_agg('''' || name || ' v' || version || '''', ', ' ORDER BY name, version) FROM fby_projection WHERE dropped_at IS NULL),
    '; no projections exist'
  );
$$ LANGUAGE sql STABLE;

END TRANSACTION;
