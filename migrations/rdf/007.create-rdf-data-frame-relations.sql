START TRANSACTION;

CREATE TYPE rdf_action_type AS ENUM ('PUT', 'DELETE');

CREATE TABLE rdf_data_frame (
  id SERIAL PRIMARY KEY,
  change_set_id INTEGER REFERENCES rdf_change_set (id) NOT NULL,
  entity_id INTEGER REFERENCES rdf_entity (id) NOT NULL,
  action rdf_action_type NOT NULL
);

CREATE FUNCTION rdf_add_data_frame(p_change_set_id INTEGER, p_entity_id INTEGER, p_action rdf_action_type) RETURNS INTEGER
AS $$
  DECLARE
    v_frame_id INTEGER;
  BEGIN
    INSERT INTO rdf_data_frame (change_set_id, entity_id, action) 
    VALUES (p_change_set_id, p_entity_id, p_action) 
    RETURNING id INTO v_frame_id;

    RETURN v_frame_id;
  END;
$$ LANGUAGE plpgsql;


END TRANSACTION;