START TRANSACTION;

CREATE TABLE rdf_projection (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT rdf_projection_name_version_uniq UNIQUE (name, version)
);

END TRANSACTION;