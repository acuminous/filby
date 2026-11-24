START TRANSACTION;

ALTER TABLE fby_projection ADD COLUMN root_entity_id INTEGER REFERENCES fby_entity (id);
ALTER TABLE fby_projection ADD COLUMN page_size INTEGER;
ALTER TABLE fby_projection ADD COLUMN page_max INTEGER;
ALTER TABLE fby_projection ADD COLUMN dropped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fby_projection ADD COLUMN function_arguments TEXT;
ALTER TABLE fby_projection ADD COLUMN function_from TEXT;

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

CREATE FUNCTION fby_create_projection_function(p_projection_id INTEGER) RETURNS VOID
AS $$
DECLARE
  v_projection RECORD;
  v_function TEXT;
  v_columns TEXT;
  v_outputs TEXT;
BEGIN
  SELECT name, version, root_entity_id, fields, aliases, function_arguments, function_from INTO v_projection
  FROM fby_projection
  WHERE id = p_projection_id;

  v_function := 'get_' || lower(regexp_replace(v_projection.name || ' v' || v_projection.version, '\s', '_', 'g'));

  SELECT
    string_agg(format('%I %s', COALESCE(s.alias, f.name), f.type), ', ' ORDER BY s.ordinality NULLS LAST, f.position),
    string_agg(format('a.%I', f.name), ', ' ORDER BY s.ordinality NULLS LAST, f.position)
  INTO v_columns, v_outputs
  FROM fby_entity_field f
  LEFT JOIN (
    SELECT u.field, u.alias, u.ordinality
    FROM unnest(v_projection.fields, v_projection.aliases) WITH ORDINALITY u(field, alias, ordinality)
    UNION ALL
    SELECT DISTINCT o.parent_field, o.parent_field, NULL::BIGINT
    FROM fby_projection_nest n
    INNER JOIN fby_projection_nest_on o ON o.nest_id = n.id
    WHERE v_projection.fields IS NOT NULL
      AND n.projection_id = p_projection_id
      AND n.parent_nest_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM unnest(v_projection.fields, v_projection.aliases) u(field, alias) WHERE u.field = o.parent_field AND u.alias = o.parent_field)
  ) s ON s.field = f.name
  WHERE f.entity_id = v_projection.root_entity_id
    AND (v_projection.fields IS NULL OR s.field IS NOT NULL);

  EXECUTE format(
    'CREATE FUNCTION %I(%s) RETURNS TABLE (%s, fby_total INTEGER) AS %L LANGUAGE sql STABLE',
    v_function,
    v_projection.function_arguments,
    v_columns,
    format('SELECT %s, COUNT(*) OVER ()::INTEGER AS fby_total %s', v_outputs, v_projection.function_from)
  );
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
