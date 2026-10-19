START TRANSACTION;

ALTER TABLE fby_hook ADD CONSTRAINT uniq_fby_hook_id_event UNIQUE (id, event);

ALTER TABLE fby_hook DROP CONSTRAINT chk_fby_hook_event_projection_id;
ALTER TABLE fby_hook ADD CONSTRAINT chk_fby_hook_event_projection_id CHECK (
  event IN ('ADD_CHANGE_SET', 'COMMENCE_CHANGE_SET')
  OR
  projection_id IS NULL
);

ALTER TABLE fby_notification ADD COLUMN event fby_event_type;

UPDATE fby_notification n SET event = h.event FROM fby_hook h WHERE h.id = n.hook_id;

ALTER TABLE fby_notification
  ALTER COLUMN event SET NOT NULL,
  DROP CONSTRAINT fby_notification_hook_id_fkey,
  ADD CONSTRAINT fk_fby_notification_hook_id_event FOREIGN KEY (hook_id, event) REFERENCES fby_hook (id, event) ON DELETE CASCADE,
  DROP CONSTRAINT uniq_fby_notification_hid_pname_pversion_status;

CREATE UNIQUE INDEX uniq_fby_notification_hid_pname_pversion_status ON fby_notification (hook_id, projection_name, projection_version, status) WHERE event <> 'COMMENCE_CHANGE_SET';
CREATE UNIQUE INDEX uniq_fby_notification_hid_pname_pversion_scheduled_for ON fby_notification (hook_id, projection_name, projection_version, scheduled_for) WHERE event = 'COMMENCE_CHANGE_SET';

CREATE FUNCTION fby_default_notification_event() RETURNS TRIGGER
AS $$
BEGIN
  IF NEW.event IS NULL THEN
    SELECT event INTO NEW.event FROM fby_hook WHERE id = NEW.hook_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fby_default_notification_event
BEFORE INSERT ON fby_notification
FOR EACH ROW EXECUTE FUNCTION fby_default_notification_event();

DROP FUNCTION fby_schedule_notification(INTEGER, TEXT, INTEGER);

CREATE FUNCTION fby_schedule_notification(p_hook_id INTEGER, p_projection_name TEXT, p_projection_version INTEGER, p_scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT now()) RETURNS VOID
AS $$
DECLARE
  v_event fby_event_type;
BEGIN
  SELECT event INTO v_event FROM fby_hook WHERE id = p_hook_id;

  IF v_event = 'COMMENCE_CHANGE_SET' THEN
    INSERT INTO fby_notification(hook_id, event, projection_name, projection_version, scheduled_for) VALUES
    (p_hook_id, v_event, p_projection_name, p_projection_version, p_scheduled_for)
    ON CONFLICT (hook_id, projection_name, projection_version, scheduled_for) WHERE event = 'COMMENCE_CHANGE_SET' DO UPDATE SET
      id = EXCLUDED.id,
      attempts = 0,
      last_attempted = NULL,
      last_error = NULL;
  ELSE
    INSERT INTO fby_notification(hook_id, event, projection_name, projection_version) VALUES
    (p_hook_id, v_event, p_projection_name, p_projection_version)
    ON CONFLICT (hook_id, projection_name, projection_version, status) WHERE event <> 'COMMENCE_CHANGE_SET' DO UPDATE SET
      id = EXCLUDED.id,
      scheduled_for = EXCLUDED.scheduled_for,
      attempts = 0,
      last_attempted = NULL,
      last_error = NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION fby_notify_add_change_set(TEXT, INTEGER);

CREATE FUNCTION fby_notify_add_change_set(p_change_set_id INTEGER, p_name TEXT, p_version INTEGER) RETURNS VOID
AS $$
DECLARE
  v_scheduled_for TIMESTAMP WITH TIME ZONE;
  projection RECORD;
BEGIN
  SELECT greatest(effective, now()) INTO v_scheduled_for FROM fby_change_set WHERE id = p_change_set_id;

  FOR projection IN (
    SELECT DISTINCT p.id, p.name, p.version
    FROM fby_entity e
    INNER JOIN fby_projection_entity pe ON pe.entity_id = e.id
    INNER JOIN fby_projection p ON p.id = pe.projection_id
    WHERE e.name = p_name AND e.version = p_version
  )
  LOOP
    PERFORM fby_schedule_notification(h.id, projection.name, projection.version, v_scheduled_for)
    FROM fby_hook h
    WHERE h.event IN ('ADD_CHANGE_SET', 'COMMENCE_CHANGE_SET')
      AND (h.projection_id = projection.id OR h.projection_id IS NULL);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fby_reissue_change_sets(p_change_set_id INTEGER) RETURNS VOID
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

      PERFORM fby_notify_add_change_set(v_reissued_id, v_entity.name, v_entity.version);
    END LOOP;

    UPDATE fby_change_set SET superseded_by = v_reissued_id WHERE id = v_superseded.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
