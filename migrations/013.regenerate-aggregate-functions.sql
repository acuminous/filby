START TRANSACTION;

DO $$
DECLARE
  v_entity RECORD;
  v_table TEXT;
  v_columns TEXT;
  v_fields TEXT;
  v_outputs TEXT;
  v_keys TEXT;
  v_key_order TEXT;
BEGIN
  FOR v_entity IN SELECT id, name, version FROM fby_entity ORDER BY id LOOP
    v_table := lower(regexp_replace(v_entity.name || ' v' || v_entity.version, '\s', '_', 'g'));

    SELECT
      string_agg(format('%I %s', name, type), ', ' ORDER BY position),
      string_agg(format('x.%I', name), ', ' ORDER BY position),
      string_agg(format('a.%I', name), ', ' ORDER BY position)
    INTO v_columns, v_fields, v_outputs
    FROM fby_entity_field
    WHERE entity_id = v_entity.id;

    SELECT
      string_agg(format('%I', name), ', ' ORDER BY position),
      string_agg(format('x.%I ASC', name), ', ' ORDER BY position)
    INTO v_keys, v_key_order
    FROM fby_entity_field
    WHERE entity_id = v_entity.id
      AND identity;

    EXECUTE format($function$
      CREATE OR REPLACE FUNCTION %I(p_change_set_id INTEGER) RETURNS TABLE (%s)
      AS $body$
        WITH specified_change_set AS (
          SELECT * FROM fby_change_set cs
          WHERE cs.id = p_change_set_id
        ), aggregated AS (
          SELECT
            DISTINCT ON (%s)
            f.action AS fby_action,
            %s
          FROM
            specified_change_set scs,
            fby_data_frame f
          INNER JOIN fby_entity e ON e.id = f.entity_id
          INNER JOIN fby_change_set cs ON cs.id = f.change_set_id
          INNER JOIN %I x ON x.fby_frame_id = f.id
          WHERE e.name = %L
            AND e.version = %L
            AND f.change_set_id <= p_change_set_id
            AND cs.effective <= scs.effective
          ORDER BY
            %s,
            cs.effective DESC,
            f.change_set_id DESC,
            x.fby_frame_id DESC
        )
        SELECT %s
        FROM aggregated a
        WHERE a.fby_action <> 'DELETE';
      $body$ LANGUAGE sql STABLE
    $function$, 'get_' || v_table || '_aggregate', v_columns, v_keys, v_fields, v_table, v_entity.name, v_entity.version, v_key_order, v_outputs);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
