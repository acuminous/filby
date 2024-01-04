START TRANSACTION;

CREATE TABLE rdf_hook (
  id SERIAL PRIMARY KEY,
  projection_id INTEGER REFERENCES rdf_projection (id) NOT NULL,
  event TEXT NOT NULL,
  CONSTRAINT rdf_hook_projection_id_consumer_uniq UNIQUE (projection_id, event)
);

END TRANSACTION;