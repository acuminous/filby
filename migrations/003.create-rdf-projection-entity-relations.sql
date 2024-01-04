START TRANSACTION;

CREATE TABLE rdf_projection_entity (
  projection_id INTEGER REFERENCES rdf_projection (id) NOT NULL,
  entity_id INTEGER REFERENCES rdf_entity (id) NOT NULL,
  PRIMARY KEY (projection_id, entity_id)
);

END TRANSACTION;
