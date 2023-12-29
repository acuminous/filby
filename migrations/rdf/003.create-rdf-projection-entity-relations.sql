START TRANSACTION;

CREATE TABLE rdf_projection_entity (
  projection_id INTEGER REFERENCES rdf_projection (id) NOT NULL,
  entity_id INTEGER REFERENCES rdf_entity (id) NOT NULL,
  PRIMARY KEY (projection_id, entity_id)
);

CREATE FUNCTION rdf_add_projection_dependency(p_projection_id INTEGER, p_name TEXT, p_version INTEGER) RETURNS VOID
AS $$
  DECLARE
    v_entity_id INTEGER;
  BEGIN
    SELECT id INTO v_entity_id FROM rdf_entity WHERE name = p_name AND version = p_version;    
    INSERT INTO rdf_projection_entity (projection_id, entity_id) VALUES (p_projection_id, v_entity_id);
  END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
