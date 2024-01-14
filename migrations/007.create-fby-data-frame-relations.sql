START TRANSACTION;

CREATE TYPE fby_action_type AS ENUM ('POST', 'DELETE');

CREATE TABLE fby_data_frame (
  id SERIAL PRIMARY KEY,
  change_set_id INTEGER REFERENCES fby_change_set (id) NOT NULL,
  entity_id INTEGER REFERENCES fby_entity (id) ON DELETE CASCADE NOT NULL,
  action fby_action_type NOT NULL
);

END TRANSACTION;