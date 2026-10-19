START TRANSACTION;

CREATE FUNCTION fby_reissue_change_sets(p_change_set_id INTEGER) RETURNS VOID
AS $$
DECLARE
  v_superseded RECORD;
  v_reissued_id INTEGER;
  v_entity RECORD;
  v_table TEXT;
  v_columns TEXT;
BEGIN
  FOR v_superseded IN
    SELECT cs.id, cs.description, cs.effective
    FROM fby_change_set cs, fby_change_set added
    WHERE added.id = p_change_set_id
      AND cs.id < added.id
      AND cs.effective > added.effective
      AND cs.superseded_by IS NULL
    ORDER BY cs.effective, cs.id
  LOOP
    INSERT INTO fby_change_set (effective, description, reissued_from) VALUES
    (v_superseded.effective, v_superseded.description, v_superseded.id)
    RETURNING id INTO v_reissued_id;

    FOR v_entity IN
      SELECT DISTINCT e.id, e.name, e.version
      FROM fby_data_frame f
      INNER JOIN fby_entity e ON e.id = f.entity_id
      WHERE f.change_set_id = v_superseded.id
      ORDER BY e.id
    LOOP
      v_table := lower(regexp_replace(v_entity.name || ' v' || v_entity.version, '\s', '_', 'g'));

      SELECT string_agg(format('%I', name), ', ' ORDER BY position)
      INTO v_columns
      FROM fby_entity_field
      WHERE entity_id = v_entity.id;

      EXECUTE format(
        'WITH frames AS (SELECT f.id, f.action, nextval(pg_get_serial_sequence(''fby_data_frame'', ''id'')) AS reissued_frame_id FROM fby_data_frame f WHERE f.change_set_id = $1 AND f.entity_id = $2 ORDER BY f.id), '
        'reissued_frames AS (INSERT INTO fby_data_frame (id, change_set_id, entity_id, action) SELECT reissued_frame_id, $3, $2, action FROM frames) '
        'INSERT INTO %I (fby_frame_id, fby_change_set_id, %s) SELECT f.reissued_frame_id, $3, %s FROM frames f INNER JOIN %I x ON x.fby_frame_id = f.id',
        v_table, v_columns, v_columns, v_table
      ) USING v_superseded.id, v_entity.id, v_reissued_id;

      PERFORM fby_notify_add_change_set(v_entity.name, v_entity.version);
    END LOOP;

    UPDATE fby_change_set SET superseded_by = v_reissued_id WHERE id = v_superseded.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
