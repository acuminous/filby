START TRANSACTION;

CREATE TABLE fby_projection_nest (
  id SERIAL PRIMARY KEY,
  projection_id INTEGER REFERENCES fby_projection (id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  entity_id INTEGER REFERENCES fby_entity (id) NOT NULL,
  CONSTRAINT uniq_fby_projection_nest_projection_id_position UNIQUE (projection_id, position),
  CONSTRAINT uniq_fby_projection_nest_projection_id_name UNIQUE (projection_id, name)
);

CREATE TABLE fby_projection_nest_on (
  nest_id INTEGER REFERENCES fby_projection_nest (id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  field TEXT NOT NULL,
  root_field TEXT NOT NULL,
  PRIMARY KEY (nest_id, position)
);

CREATE TABLE fby_projection_nest_order (
  nest_id INTEGER REFERENCES fby_projection_nest (id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  field TEXT NOT NULL,
  direction TEXT NOT NULL,
  nulls TEXT,
  PRIMARY KEY (nest_id, position),
  CONSTRAINT chk_fby_projection_nest_order_direction CHECK (direction IN ('ASC', 'DESC')),
  CONSTRAINT chk_fby_projection_nest_order_nulls CHECK (nulls IN ('FIRST', 'LAST'))
);

END TRANSACTION;
