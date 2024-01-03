START TRANSACTION;

CREATE TYPE rdf_action_type AS ENUM ('PUT', 'DELETE');

CREATE TABLE rdf_data_frame (
  id SERIAL PRIMARY KEY,
  change_set_id INTEGER REFERENCES rdf_change_set (id) NOT NULL,
  entity_id INTEGER REFERENCES rdf_entity (id) NOT NULL,
  action rdf_action_type NOT NULL
);

END TRANSACTION;