START TRANSACTION;

CREATE TABLE park_v1 (
  rdf_frame_id INTEGER PRIMARY KEY REFERENCES rdf_data_frame (id),
  code TEXT NOT NULL,
  name TEXT
);

CREATE FUNCTION get_squashed_park_v1(p_change_set_id INTEGER) RETURNS TABLE (
  rdf_action rdf_action_type,
  code TEXT,
  name TEXT
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DISTINCT ON (code)
    f.action AS rdf_action,
    p.code,
    p.name
  FROM 
    rdf_data_frame f
  INNER JOIN rdf_entity e ON e.id = f.entity_id
  INNER JOIN park_v1 p ON p.rdf_frame_id = f.id
  WHERE e.name = 'park' AND e.version = 1 AND f.change_set_id <= p_change_set_id
  ORDER BY
    p.code ASC, 
    p.rdf_frame_id DESC;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION put_park_v1(p_change_set_id INTEGER, p_code TEXT, p_name TEXT) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'PUT') INTO v_frame_id;
  INSERT INTO park_v1 (rdf_frame_id, code, name) VALUES (v_frame_id, p_code, p_name);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION delete_park_v1(p_change_set_id INTEGER, p_code TEXT) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'DELETE') INTO v_frame_id;
  INSERT INTO park_v1 (rdf_frame_id, code) VALUES (v_frame_id, p_code);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;

