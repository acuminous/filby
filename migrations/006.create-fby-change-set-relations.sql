START TRANSACTION;

CREATE EXTENSION pgcrypto;

CREATE TABLE fby_change_set (
  id SERIAL PRIMARY KEY,
  effective TIMESTAMP WITH TIME ZONE NOT NULL,
  description TEXT,
  last_modified TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  entity_tag TEXT NOT NULL DEFAULT encode(gen_random_bytes(10), 'hex')
);

CREATE INDEX fby_change_set_effective_idx ON fby_change_set (effective DESC);

INSERT INTO fby_change_set (id, effective, description, last_modified, entity_tag) VALUES
(0, '0001-01-01T00:00:00Z', 'Null Change Set - DO NOT DELETE', '0001-01-1T00:00:00Z', 'fffffffffffffffffff');

CREATE FUNCTION fby_prevent_null_change_set_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.id = 0 THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fby_prevent_null_change_set_deletion_trigger
BEFORE DELETE ON fby_change_set
FOR EACH ROW EXECUTE FUNCTION fby_prevent_null_change_set_deletion();

END TRANSACTION;