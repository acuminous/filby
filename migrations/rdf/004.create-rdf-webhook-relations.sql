START TRANSACTION;

CREATE TABLE rdf_webhook (
  id SERIAL PRIMARY KEY,
  projection_id INTEGER REFERENCES rdf_projection (id) NOT NULL,
  url TEXT NOT NULL,  
  CONSTRAINT rdf_webhook_projection_id_url_uniq UNIQUE (projection_id, url)
);

CREATE FUNCTION rdf_add_webhook(p_projection_id INTEGER, p_url TEXT) RETURNS VOID
AS $$
  BEGIN
    INSERT INTO rdf_webhook (projection_id, url) VALUES (p_projection_id, p_url);
  END;
$$ LANGUAGE plpgsql;

END TRANSACTION;