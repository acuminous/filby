START TRANSACTION;

CREATE EXTENSION pgcrypto;

CREATE TABLE rdf_change_set (
  id SERIAL PRIMARY KEY,
  effective_from TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  last_modified TIMESTAMP WITH TIME ZONE NOT NULL,
  entity_tag TEXT NOT NULL
);

CREATE INDEX rdf_change_set_effective_from_idx ON rdf_change_set (effective_from DESC);

CREATE FUNCTION rdf_add_change_set(p_effective_from TIMESTAMP WITH TIME ZONE, p_notes TEXT) RETURNS INTEGER
AS $$
  DECLARE
    v_last_modified TIMESTAMP WITH TIME ZONE := now();
    v_entity_tag TEXT := encode(gen_random_bytes(10), 'hex');
    v_change_set_id INTEGER;
  BEGIN
    INSERT INTO rdf_change_set (effective_from, notes, last_modified, entity_tag) 
    VALUES (p_effective_from, p_notes, v_last_modified, v_entity_tag) 
    RETURNING id INTO v_change_set_id;

    RETURN v_change_set_id;
  END;
$$ LANGUAGE plpgsql;

END TRANSACTION;