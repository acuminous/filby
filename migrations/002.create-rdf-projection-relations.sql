START TRANSACTION;

CREATE TABLE fby_projection (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  CONSTRAINT fby_projection_name_version_uniq UNIQUE (name, version)
);

END TRANSACTION;