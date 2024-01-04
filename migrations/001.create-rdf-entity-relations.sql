START TRANSACTION;

CREATE TABLE rdf_entity (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT rdf_entity_name_version_uniq UNIQUE (name, version)
);

END TRANSACTION;