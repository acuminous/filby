START TRANSACTION;

CREATE TYPE fby_event_type AS ENUM (
  'ADD_PROJECTION',
  'DROP_PROJECTION',
  'ADD_CHANGE_SET'
);

CREATE TABLE fby_hook (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event fby_event_type NOT NULL,
  projection_id INTEGER REFERENCES fby_projection (id) ON DELETE CASCADE,
  CONSTRAINT uniq_fby_hook_name UNIQUE NULLS NOT DISTINCT (name),
  CONSTRAINT chk_fby_hook_event_projection_id CHECK (
    (event = 'ADD_CHANGE_SET')
    OR
    (event <> 'ADD_CHANGE_SET' AND projection_id IS NULL)
  )
);

END TRANSACTION;