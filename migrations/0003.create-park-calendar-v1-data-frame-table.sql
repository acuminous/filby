START TRANSACTION;

CREATE table park_calendar_v1_data_frame (
  frame_id serial PRIMARY KEY,
  rdf_change_set_id INTEGER NOT NULL REFERENCES rdf_change_set (id),
  rdf_action rdf_action_type NOT NULL,
  park_code TEXT NOT NULL,
  event park_calendar_event_type NOT NULL,
  occurs TIMESTAMP WITH TIME ZONE
);

END TRANSACTION;