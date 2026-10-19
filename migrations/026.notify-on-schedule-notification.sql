START TRANSACTION;

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

END TRANSACTION;
