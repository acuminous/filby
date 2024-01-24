START TRANSACTION;

CREATE EXTENSION pgcrypto;

CREATE TABLE fby_change_set (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  effective TIMESTAMP WITH TIME ZONE NOT NULL,
  last_modified TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  entity_tag TEXT NOT NULL DEFAULT encode(gen_random_bytes(10), 'hex')
);

CREATE INDEX fby_change_set_effective_idx ON fby_change_set (effective DESC);

END TRANSACTION;