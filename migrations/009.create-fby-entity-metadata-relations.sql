START TRANSACTION;

CREATE TABLE fby_entity_field (
  entity_id INTEGER REFERENCES fby_entity (id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  identity BOOLEAN NOT NULL,
  PRIMARY KEY (entity_id, position),
  CONSTRAINT uniq_fby_entity_field_entity_id_name UNIQUE (entity_id, name)
);

CREATE TABLE fby_entity_check (
  entity_id INTEGER REFERENCES fby_entity (id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  expression TEXT NOT NULL,
  PRIMARY KEY (entity_id, name)
);

CREATE TABLE fby_enum (
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (name, position),
  CONSTRAINT uniq_fby_enum_name_value UNIQUE (name, value)
);

END TRANSACTION;
