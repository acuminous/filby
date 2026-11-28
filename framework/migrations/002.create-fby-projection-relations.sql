START TRANSACTION;

CREATE TABLE fby_projection (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT,
  CONSTRAINT uniq_fby_projection_name_version UNIQUE (name, version)
);

END TRANSACTION;