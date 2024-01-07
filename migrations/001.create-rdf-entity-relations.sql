START TRANSACTION;

CREATE TABLE fby_entity (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT fby_entity_name_version_uniq UNIQUE (name, version)
);

END TRANSACTION;