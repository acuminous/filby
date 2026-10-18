START TRANSACTION;

DO $$
DECLARE
  v_entity RECORD;
  v_table TEXT;
  v_keys TEXT;
  v_qualified_keys TEXT;
  v_key_values TEXT;
  v_key_constraints TEXT;
  v_constraint_suffix TEXT;
  v_description TEXT;
  v_key TEXT;
  v_constraint TEXT;
BEGIN
  FOR v_entity IN SELECT id, name, version FROM fby_entity ORDER BY id LOOP
    v_table := lower(regexp_replace(v_entity.name || ' v' || v_entity.version, '\s', '_', 'g'));

    SELECT
      string_agg(format('%I', name), ', ' ORDER BY position),
      string_agg(format('x.%I', name), ', ' ORDER BY position),
      string_agg(format('%L || x.%I::TEXT', name || '=', name), ' || '', '' || ' ORDER BY position),
      string_agg(format('ALTER COLUMN %I SET NOT NULL', name), ', ' ORDER BY position),
      string_agg(name, '_' ORDER BY position)
    INTO v_keys, v_qualified_keys, v_key_values, v_key_constraints, v_constraint_suffix
    FROM fby_entity_field
    WHERE entity_id = v_entity.id
      AND identity;

    EXECUTE format('ALTER TABLE %I ADD COLUMN fby_change_set_id INTEGER', v_table);
    EXECUTE format('UPDATE %I x SET fby_change_set_id = f.change_set_id FROM fby_data_frame f WHERE f.id = x.fby_frame_id', v_table);

    EXECUTE format(
      'SELECT cs.description, %s FROM %I x INNER JOIN fby_change_set cs ON cs.id = x.fby_change_set_id GROUP BY cs.id, cs.description, %s HAVING COUNT(*) > 1 ORDER BY cs.id LIMIT 1',
      v_key_values, v_table, v_qualified_keys
    ) INTO v_description, v_key;

    IF v_description IS NOT NULL THEN
      RAISE EXCEPTION 'Entity ''% v%'' has more than one frame with key (%) in change set ''%''', v_entity.name, v_entity.version, v_key, v_description
        USING HINT = 'Keep one frame per key in each change set. See the CHANGELOG for a query that lists every duplicate.';
    END IF;

    FOR v_constraint IN
      SELECT c.conname
      FROM pg_constraint c
      INNER JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'fby_frame_id'
      WHERE c.conrelid = to_regclass(format('%I', v_table))
        AND a.attnum = ANY (c.conkey)
        AND (c.contype = 'u' OR (c.contype = 'f' AND c.confrelid = 'fby_data_frame'::regclass))
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', v_table, v_constraint);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN fby_change_set_id SET NOT NULL, %s, ADD CONSTRAINT %I FOREIGN KEY (fby_frame_id, fby_change_set_id) REFERENCES fby_data_frame (id, change_set_id) ON DELETE CASCADE, ADD CONSTRAINT %I UNIQUE (fby_change_set_id, %s)',
      v_table, v_key_constraints, 'fk_' || v_table || '_fby_data_frame', 'uniq_' || v_table || '_fby_change_set_id_' || v_constraint_suffix, v_keys
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
