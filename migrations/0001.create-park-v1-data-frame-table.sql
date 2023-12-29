START TRANSACTION;

CREATE table park_v1_data_frame (
  frame_id serial PRIMARY KEY,
  rdf_change_set_id INTEGER NOT NULL REFERENCES rdf_change_set (id),
  rdf_action rdf_action_type NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE UNIQUE INDEX park_v1_data_frame_rdf_change_set_id_rdf_action_code_uniq ON park_v1_data_frame (rdf_change_set_id DESC, rdf_action, code);

END TRANSACTION;

