START TRANSACTION;

CREATE TABLE fby_projection_entity (
  projection_id INTEGER REFERENCES fby_projection (id) ON DELETE CASCADE NOT NULL,
  entity_id INTEGER REFERENCES fby_entity (id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (projection_id, entity_id)
);

END TRANSACTION;
