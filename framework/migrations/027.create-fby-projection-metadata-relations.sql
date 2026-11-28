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
  since INTEGER,
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
  v_parameter RECORD;
  v_nest RECORD;
  v_function TEXT;
  v_columns TEXT;
  v_outputs TEXT;
  v_arguments TEXT := 'p_change_set_id INTEGER';
  v_predicates TEXT[] := '{}';
  v_position INTEGER := 1;
  v_segments TEXT[];
  v_leaf TEXT;
  v_parent_nest_id INTEGER;
  v_entity_id INTEGER;
  v_alias TEXT;
  v_sources TEXT[];
  v_joins TEXT[];
  v_array BOOLEAN;
  v_type TEXT;
  v_argument TEXT;
  v_column TEXT;
  v_first TEXT;
  v_second TEXT;
  v_omitted TEXT;
  v_predicate TEXT;
  v_order TEXT;
  v_size TEXT;
BEGIN
  SELECT p.name, p.version, p.root_entity_id, p.fields, p.aliases, p.page_size, p.page_max, e.name AS root_name, e.version AS root_version INTO v_projection
  FROM fby_projection p
  INNER JOIN fby_entity e ON e.id = p.root_entity_id
  WHERE p.id = p_projection_id;

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

  FOR v_parameter IN
    SELECT name, field, match
    FROM fby_projection_parameter
    WHERE projection_id = p_projection_id
    ORDER BY position
  LOOP
    v_segments := string_to_array(v_parameter.field, '.');
    v_leaf := v_segments[cardinality(v_segments)];
    v_parent_nest_id := NULL;
    v_entity_id := v_projection.root_entity_id;
    v_alias := 'a';
    v_sources := '{}';
    v_joins := '{}';

    FOR v_depth IN 1 .. cardinality(v_segments) - 1 LOOP
      SELECT
        n.id,
        n.entity_id,
        format('%I($1) n%s', 'get_' || lower(regexp_replace(e.name || ' v' || e.version, '\s', '_', 'g')) || '_aggregate', v_depth) AS source,
        (SELECT string_agg(format('n%s.%I = %s.%I', v_depth, o.field, v_alias, o.parent_field), ' AND ' ORDER BY o.position) FROM fby_projection_nest_on o WHERE o.nest_id = n.id) AS joins
      INTO v_nest
      FROM fby_projection_nest n
      INNER JOIN fby_entity e ON e.id = n.entity_id
      WHERE n.projection_id = p_projection_id
        AND n.parent_nest_id IS NOT DISTINCT FROM v_parent_nest_id
        AND n.name = v_segments[v_depth];

      v_parent_nest_id := v_nest.id;
      v_entity_id := v_nest.entity_id;
      v_alias := 'n' || v_depth;
      v_sources := v_sources || v_nest.source;
      v_joins := v_joins || v_nest.joins;
    END LOOP;

    SELECT COALESCE(t.typcategory = 'A', FALSE), CASE WHEN t.typcategory = 'A' THEN format_type(t.typelem, NULL) ELSE f.type END INTO v_array, v_type
    FROM fby_entity_field f
    LEFT JOIN pg_type t ON t.oid = to_regtype(f.type)
    WHERE f.entity_id = v_entity_id
      AND f.name = v_leaf;

    v_argument := 'p_' || lower(regexp_replace(v_parameter.name, '\s', '_', 'g'));
    v_column := format('%s.%I', v_alias, v_leaf);
    v_first := '$' || (v_position + 1);
    v_second := '$' || (v_position + 2);

    IF v_parameter.match = 'range' THEN
      v_arguments := v_arguments || format(', %I %s DEFAULT NULL, %I %s DEFAULT NULL', v_argument || '_from', v_type, v_argument || '_to', v_type);
      v_predicate := format('(%1$s IS NULL OR %2$s >= %1$s) AND (%3$s IS NULL OR %2$s <= %3$s)', v_first, v_column, v_second);
      v_omitted := format('%s IS NULL AND %s IS NULL', v_first, v_second);
      v_position := v_position + 2;
    ELSE
      v_arguments := v_arguments || format(', %I %s DEFAULT NULL', v_argument, v_type || CASE WHEN v_parameter.match = 'in' THEN '[]' ELSE '' END);
      v_predicate := format(CASE
        WHEN v_parameter.match = 'prefix' THEN '(%1$s IS NULL OR starts_with(%2$s, %1$s))'
        WHEN v_parameter.match = 'in' AND v_array THEN '(%1$s IS NULL OR %2$s && %1$s)'
        WHEN v_parameter.match = 'in' THEN '(%1$s IS NULL OR %2$s = ANY(%1$s))'
        WHEN v_parameter.match = 'contains' THEN '(%1$s IS NULL OR %1$s = ANY(%2$s))'
        WHEN v_parameter.match = 'gt' THEN '(%1$s IS NULL OR %2$s > %1$s)'
        WHEN v_parameter.match = 'gte' THEN '(%1$s IS NULL OR %2$s >= %1$s)'
        WHEN v_parameter.match = 'lt' THEN '(%1$s IS NULL OR %2$s < %1$s)'
        WHEN v_parameter.match = 'lte' THEN '(%1$s IS NULL OR %2$s <= %1$s)'
        ELSE '(%1$s IS NULL OR %2$s = %1$s)'
      END, v_first, v_column);
      v_omitted := format('%s IS NULL', v_first);
      v_position := v_position + 1;
    END IF;

    IF cardinality(v_sources) > 0 THEN
      v_predicate := format('((%s) OR EXISTS (SELECT 1 FROM %s WHERE %s AND %s))', v_omitted, array_to_string(v_sources, ', '), array_to_string(v_joins, ' AND '), v_predicate);
    END IF;

    v_predicates := v_predicates || v_predicate;
  END LOOP;

  SELECT concat_ws(', ',
    (SELECT string_agg(format('a.%I %s%s', field, direction, COALESCE(' NULLS ' || nulls, '')), ', ' ORDER BY position) FROM fby_projection_order WHERE projection_id = p_projection_id),
    (SELECT string_agg(format('a.%I ASC', name), ', ' ORDER BY position) FROM fby_entity_field WHERE entity_id = v_projection.root_entity_id AND identity)
  ) INTO v_order;

  v_arguments := v_arguments || format(', p_page_offset INTEGER DEFAULT 0, p_page_size INTEGER DEFAULT %s', COALESCE(v_projection.page_size::TEXT, 'NULL'));
  v_size := CASE WHEN v_projection.page_max IS NULL THEN '$' || (v_position + 2) ELSE format('LEAST($%s, %s)', v_position + 2, v_projection.page_max) END;

  EXECUTE format(
    'CREATE FUNCTION %I(%s) RETURNS TABLE (%s, fby_total INTEGER) AS %L LANGUAGE sql STABLE',
    v_function,
    v_arguments,
    v_columns,
    format(
      'SELECT %s, COUNT(*) OVER ()::INTEGER AS fby_total FROM %I($1) a WHERE %s ORDER BY %s LIMIT %s OFFSET $%s',
      v_outputs,
      'get_' || lower(regexp_replace(v_projection.root_name || ' v' || v_projection.root_version, '\s', '_', 'g')) || '_aggregate',
      COALESCE(NULLIF(array_to_string(v_predicates, ' AND '), ''), 'TRUE'),
      v_order,
      v_size,
      v_position + 1
    )
  );
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
