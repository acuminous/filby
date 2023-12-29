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

CREATE FUNCTION rdf_track_change_set_changes_fn()
RETURNS TRIGGER
AS $$
BEGIN
  NEW.last_modified := now();
  NEW.entity_tag := encode(gen_random_bytes(10), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rdf_track_change_set_changes_tr
BEFORE INSERT OR UPDATE
ON rdf_change_set
FOR EACH ROW
EXECUTE FUNCTION rdf_track_change_set_changes_fn();

END TRANSACTION;