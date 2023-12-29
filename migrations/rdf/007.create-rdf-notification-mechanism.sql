START TRANSACTION;

CREATE TYPE rdf_notification_status AS ENUM ('PENDING', 'OK');

CREATE TABLE rdf_notification (
  id SERIAL PRIMARY KEY,
  webhook_id INTEGER REFERENCES rdf_webhook (id),
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  attempts INTEGER DEFAULT 0,
  status rdf_notification_status NOT NULL DEFAULT 'PENDING',
  last_attempted_at TIMESTAMP WITH TIME ZONE,
  last_status_code INTEGER,
  last_error TEXT
);

CREATE FUNCTION rdf_schedule_notification(p_webhook_id INTEGER)
RETURNS VOID
AS $$
BEGIN
  INSERT INTO rdf_notification (webhook_id, scheduled_for) VALUES (p_webhook_id, now());
END;
$$ LANGUAGE plpgsql;


CREATE TYPE rdf_entity_table_type AS (
  name TEXT,
  version INTEGER
);

CREATE FUNCTION rdf_notify_entity_change(p_input_table rdf_entity_table_type[])
RETURNS VOID
AS $$
BEGIN
  PERFORM 1 FROM (
    WITH projection AS (
      SELECT
        DISTINCT (p.id)
      FROM 
        rdf_entity e
      INNER JOIN rdf_projection_entity pe ON pe.entity_id = e.id
      INNER JOIN rdf_projection p ON p.id = pe.projection_id
      INNER JOIN UNNEST(p_input_table) i ON i.name = e.name AND i.version = e.version
    )
    SELECT
      rdf_schedule_notification(w.id)
    FROM 
      projection p
    INNER JOIN rdf_webhook w ON w.projection_id = p.id
  );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION rdf_get_next_notification(p_max_attempts INTEGER)
RETURNS TABLE (
  id INTEGER,
  webhook_id INTEGER,
  attempts INTEGER
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.webhook_id,
    n.attempts
  FROM
    rdf_notification n
  WHERE n.status = 'PENDING'
    AND n.scheduled_for <= now()
    AND n.attempts < p_max_attempts  
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION rdf_pass_notification(p_id INTEGER, p_last_status_code INTEGER)
RETURNS VOID
AS $$
BEGIN
  UPDATE rdf_notification n
  SET 
    attempts = n.attempts + 1,
    status = 'OK',
    last_attempted_at = now(),
    last_status_code = p_last_status_code,
    last_error = NULL
  WHERE
    n.id = p_id;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION rdf_fail_notification(p_id INTEGER, p_scheduled_for TIMESTAMP WITH TIME ZONE, p_last_status_code INTEGER, p_error TEXT)
RETURNS VOID
AS $$
BEGIN
  UPDATE rdf_notification n
  SET 
    attempts = n.attempts + 1,
    scheduled_for = p_scheduled_for,
    last_attempted_at = now(),
    last_status_code = p_last_status_code,
    last_error = p_error
  WHERE
    n.id = p_id;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;