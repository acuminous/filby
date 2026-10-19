START TRANSACTION;

CREATE OR REPLACE FUNCTION fby_pass_notification(p_id INTEGER) RETURNS VOID
AS $$
DECLARE
  v_hook_id INTEGER;
  v_projection_name TEXT;
  v_projection_version INTEGER;
BEGIN
  SELECT hook_id, projection_name, projection_version FROM fby_notification n WHERE n.id = p_id INTO v_hook_id, v_projection_name, v_projection_version;
  DELETE FROM fby_notification n WHERE n.hook_id = v_hook_id AND n.projection_name = v_projection_name AND n.projection_version = v_projection_version AND n.status = 'OK';
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

END TRANSACTION;
