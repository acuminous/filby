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

END TRANSACTION;