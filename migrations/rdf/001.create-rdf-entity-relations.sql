START TRANSACTION;

CREATE TABLE rdf_entity (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT rdf_entity_name_version_uniq UNIQUE (name, version)
);

CREATE FUNCTION rdf_add_entity(p_name TEXT, p_version INTEGER) RETURNS INTEGER
AS $$
  DECLARE
    v_entity_id INTEGER;
  BEGIN
    INSERT INTO rdf_entity (name, version) 
    VALUES (p_name, p_version) 
    RETURNING id INTO v_entity_id;
    
    RETURN v_entity_id;
  END;
$$ LANGUAGE plpgsql;

END TRANSACTION;