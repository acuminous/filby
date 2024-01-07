START TRANSACTION;

CREATE EXTENSION pgcrypto;

CREATE TABLE fby_change_set (
  id SERIAL PRIMARY KEY,
  effective TIMESTAMP WITH TIME ZONE NOT NULL,
  description TEXT,
  last_modified TIMESTAMP WITH TIME ZONE NOT NULL,
  entity_tag TEXT NOT NULL
);

CREATE INDEX fby_change_set_effective_idx ON fby_change_set (effective DESC);

CREATE FUNCTION fby_on_new_change_set()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_modified := now();
  NEW.entity_tag := encode(gen_random_bytes(10), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fby_change_set_insert_trigger
BEFORE INSERT ON fby_change_set
FOR EACH ROW
EXECUTE FUNCTION fby_on_new_change_set();

END TRANSACTION;