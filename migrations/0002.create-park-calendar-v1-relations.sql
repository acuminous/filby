START TRANSACTION;

CREATE TYPE park_calendar_event_type AS ENUM (
  'Park Open - Owners', 
  'Park Open - Guests', 
  'Park Close - Owners', 
  'Park Close - Guests'
);

CREATE table park_calendar_v1 (
  rdf_frame_id INTEGER PRIMARY KEY REFERENCES rdf_data_frame (id),
  id INTEGER NOT NULL,
  park_code TEXT,
  event park_calendar_event_type,
  occurs TIMESTAMP WITH TIME ZONE
);

CREATE FUNCTION get_squashed_park_calendar_v1(p_change_set_id INTEGER) RETURNS TABLE (
  rdf_action rdf_action_type,
  id INTEGER,  
  park_code TEXT,
  event park_calendar_event_type,
  occurs TIMESTAMP WITH TIME ZONE
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DISTINCT ON (pc.id)
    f.action AS rdf_action,
    pc.id,
    pc.park_code,
    pc.event,
    pc.occurs
  FROM 
    rdf_data_frame f
  INNER JOIN rdf_entity e ON e.id = f.entity_id
  INNER JOIN park_calendar_v1 pc ON pc.rdf_frame_id = f.id
  WHERE e.name = 'park_calendar' AND e.version = 1 AND f.change_set_id <= p_change_set_id
  ORDER BY
    pc.id,
    pc.rdf_frame_id DESC;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION put_park_calendar_v1(p_change_set_id INTEGER, p_id INTEGER, p_park_code TEXT, p_event park_calendar_event_type, p_occurs TIMESTAMP WITH TIME ZONE) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park_calendar';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'PUT') INTO v_frame_id;
  INSERT INTO park_calendar_v1 (rdf_frame_id, id, park_code, event, occurs) VALUES (v_frame_id, p_id, p_park_code, p_event, p_occurs);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION delete_park_calendar_v1(p_change_set_id INTEGER, p_id INTEGER) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park_calendar';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'DELETE') INTO v_frame_id;
  INSERT INTO park_v1 (rdf_frame_id, id) VALUES (v_frame_id, p_id);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;