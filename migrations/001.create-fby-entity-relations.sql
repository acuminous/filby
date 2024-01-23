START TRANSACTION;

CREATE TABLE fby_entity (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT uniq_fby_entity_name_version UNIQUE (name, version)
);

END TRANSACTION;