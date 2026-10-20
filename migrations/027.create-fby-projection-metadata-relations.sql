START TRANSACTION;

ALTER TABLE fby_projection ADD COLUMN root_entity_id INTEGER REFERENCES fby_entity (id);
ALTER TABLE fby_projection ADD COLUMN page_size INTEGER;
ALTER TABLE fby_projection ADD COLUMN page_max INTEGER;

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
  SELECT '; existing fields are ' || string_agg('''' || name || '''', ', ' ORDER BY position)
  FROM fby_entity_field
  WHERE entity_id = p_entity_id;
$$ LANGUAGE sql STABLE;

END TRANSACTION;
