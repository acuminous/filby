START TRANSACTION;

CREATE TABLE rdf_webhook (
  id SERIAL PRIMARY KEY,
  projection_id INTEGER REFERENCES rdf_projection (id) NOT NULL,
  url TEXT NOT NULL,  
  CONSTRAINT rdf_webhook_projection_id_url_uniq UNIQUE (projection_id, url)
);

END TRANSACTION;