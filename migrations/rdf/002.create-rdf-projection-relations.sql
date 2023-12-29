START TRANSACTION;

CREATE TABLE rdf_projection (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT rdf_projection_name_version_uniq UNIQUE (name, version)
);

CREATE FUNCTION rdf_add_projection(p_name TEXT, p_version INTEGER) RETURNS INTEGER
AS $$
  DECLARE
    v_projection_id INTEGER;
  BEGIN
    INSERT INTO rdf_projection (name, version) 
    VALUES (p_name, p_version) 
    RETURNING id INTO v_projection_id;
    
    RETURN v_projection_id;
  END;
$$ LANGUAGE plpgsql;

END TRANSACTION;