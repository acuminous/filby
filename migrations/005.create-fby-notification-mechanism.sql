START TRANSACTION;

CREATE TYPE fby_notification_status AS ENUM ('PENDING', 'OK');

CREATE TABLE fby_notification (
  id SERIAL PRIMARY KEY,
  hook_id INTEGER NOT NULL REFERENCES fby_hook (id) ON DELETE CASCADE,
  projection_name TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  attempts INTEGER DEFAULT 0,
  status fby_notification_status NOT NULL DEFAULT 'PENDING',
  last_attempted TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  CONSTRAINT uniq_fby_notification_hid_pname_pversion_status UNIQUE (hook_id, projection_name, projection_version, status)
);

CREATE FUNCTION fby_schedule_notification(p_hook_id INTEGER, p_projection_name TEXT, p_projection_version INTEGER) RETURNS VOID
AS $$
BEGIN
  INSERT INTO fby_notification(hook_id, projection_name, projection_version) VALUES
  (p_hook_id, p_projection_name, p_projection_version)
  ON CONFLICT (hook_id, projection_name, projection_version, status) DO UPDATE SET
    id = EXCLUDED.id,
    scheduled_for = EXCLUDED.scheduled_for,
    attempts = 0,
    last_attempted = NULL,
    last_error = NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION fby_notify_add_change_set(p_name TEXT, p_version INTEGER) RETURNS VOID
AS $$
DECLARE
  projection RECORD;
BEGIN
  FOR projection IN (
    SELECT DISTINCT p.id, p.name, p.version
    FROM fby_entity e
    INNER JOIN fby_projection_entity pe ON pe.entity_id = e.id
    INNER JOIN fby_projection p ON p.id = pe.projection_id
    WHERE e.name = p_name AND e.version = p_version
  )
  LOOP
    PERFORM fby_schedule_notification(h.id, projection.name, projection.version)
    FROM fby_hook h
    WHERE h.event = 'ADD_CHANGE_SET'
      AND (h.projection_id = projection.id OR h.projection_id IS NULL);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION fby_get_next_notification(p_max_attempts INTEGER)
RETURNS TABLE (
  id INTEGER,
  hook_id INTEGER,
  attempts INTEGER,
  projection_name TEXT,
  projection_version INTEGER
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.hook_id,
    n.attempts + 1 AS attempts,
    n.projection_name,
    n.projection_version
  FROM
    fby_notification n
  WHERE n.status = 'PENDING'
    AND n.scheduled_for <= now()
    AND n.attempts < p_max_attempts
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION fby_pass_notification(p_id INTEGER) RETURNS VOID
AS $$
DECLARE
  v_hook_id INTEGER;
BEGIN
  SELECT hook_id FROM fby_notification n WHERE n.id = p_id INTO v_hook_id;
  DELETE FROM fby_notification n WHERE n.hook_id = v_hook_id AND n.status = 'OK';
  UPDATE fby_notification n
  SET
    attempts = n.attempts + 1,
    status = 'OK',
    last_attempted = now(),
    last_error = NULL
  WHERE
    n.id = p_id;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION fby_fail_notification(p_id INTEGER, p_scheduled_for TIMESTAMP WITH TIME ZONE, p_error TEXT) RETURNS VOID
AS $$
BEGIN
  UPDATE fby_notification n
  SET
    attempts = n.attempts + 1,
    scheduled_for = p_scheduled_for,
    last_attempted = now(),
    last_error = p_error
  WHERE
    n.id = p_id;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;