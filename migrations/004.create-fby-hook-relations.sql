START TRANSACTION;

CREATE TABLE fby_hook (
  id SERIAL PRIMARY KEY,
  projection_id INTEGER REFERENCES fby_projection (id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  CONSTRAINT fby_hook_projection_id_event_uniq UNIQUE NULLS NOT DISTINCT (projection_id, event)
);

END TRANSACTION;