-- @MARV ACCEPT = 77caf46a2363da07bdc85fd33238dc8b

START TRANSACTION;

CREATE TABLE fby_change_set (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  effective TIMESTAMP WITH TIME ZONE NOT NULL,
  last_modified TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  entity_tag TEXT NOT NULL DEFAULT left(replace(gen_random_uuid()::TEXT, '-', ''), 20)
);

CREATE INDEX fby_change_set_effective_idx ON fby_change_set (effective DESC);

END TRANSACTION;
