START TRANSACTION;

ALTER TYPE fby_notification_status ADD VALUE 'CLAIMED' BEFORE 'OK';

CREATE OR REPLACE FUNCTION fby_schedule_notification(p_hook_id INTEGER, p_projection_name TEXT, p_projection_version INTEGER, p_scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT now()) RETURNS VOID
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

  PERFORM pg_notify('fby_notification', '');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fby_fail_notification(p_id INTEGER, p_scheduled_for TIMESTAMP WITH TIME ZONE, p_error TEXT) RETURNS VOID
AS $$
BEGIN
  UPDATE fby_notification n
  SET
    status = 'PENDING',
    scheduled_for = p_scheduled_for,
    last_error = p_error
  WHERE
    n.id = p_id
    AND n.status = 'CLAIMED';
EXCEPTION WHEN unique_violation THEN
  DELETE FROM fby_notification n WHERE n.id = p_id AND n.status = 'CLAIMED';
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION fby_get_next_notification(INTEGER);

CREATE FUNCTION fby_get_next_notification(p_max_attempts INTEGER, p_claim_timeout INTEGER)
RETURNS TABLE (
  id INTEGER,
  hook_id INTEGER,
  attempts INTEGER,
  projection_name TEXT,
  projection_version INTEGER
)
AS $$
DECLARE
  v_expired RECORD;
BEGIN
  FOR v_expired IN
    SELECT x.id, x.scheduled_for
    FROM fby_notification x
    WHERE x.status = 'CLAIMED'
      AND x.last_attempted < now() - p_claim_timeout * INTERVAL '1 millisecond'
    ORDER BY x.scheduled_for, x.id
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM fby_fail_notification(v_expired.id, v_expired.scheduled_for, format('Delivery did not complete within %sms', p_claim_timeout));
  END LOOP;

  RETURN QUERY
  UPDATE fby_notification n
  SET
    status = 'CLAIMED',
    attempts = n.attempts + 1,
    last_attempted = now()
  WHERE n.id = (
    SELECT c.id
    FROM fby_notification c
    WHERE c.status = 'PENDING'
      AND c.scheduled_for <= now()
      AND c.attempts < p_max_attempts
      AND (
        c.event = 'COMMENCE_CHANGE_SET'
        OR NOT EXISTS (
          SELECT 1
          FROM fby_notification d
          WHERE d.hook_id = c.hook_id
            AND d.projection_name = c.projection_name
            AND d.projection_version = c.projection_version
            AND d.event <> 'COMMENCE_CHANGE_SET'
            AND d.status = 'CLAIMED'
        )
      )
    ORDER BY c.scheduled_for, c.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING n.id, n.hook_id, n.attempts, n.projection_name, n.projection_version;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
