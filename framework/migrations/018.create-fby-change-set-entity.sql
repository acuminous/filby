START TRANSACTION;

CREATE TABLE fby_change_set_entity (
  change_set_id INTEGER REFERENCES fby_change_set (id) ON DELETE CASCADE NOT NULL,
  entity_id INTEGER REFERENCES fby_entity (id) NOT NULL,
  PRIMARY KEY (change_set_id, entity_id)
);

CREATE FUNCTION fby_record_change_set_entities() RETURNS TRIGGER
AS $$
BEGIN
  INSERT INTO fby_change_set_entity (change_set_id, entity_id)
  SELECT DISTINCT change_set_id, entity_id FROM inserted_frames
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fby_record_change_set_entities
AFTER INSERT ON fby_data_frame
REFERENCING NEW TABLE AS inserted_frames
FOR EACH STATEMENT EXECUTE FUNCTION fby_record_change_set_entities();

INSERT INTO fby_change_set_entity (change_set_id, entity_id)
SELECT DISTINCT change_set_id, entity_id FROM fby_data_frame;

CREATE OR REPLACE VIEW fby_projection_change_log_vw AS (
  SELECT
    p.id AS projection_id,
    p.name AS projection_name,
    p.version AS projection_version,
    c.id AS change_set_id,
    c.effective,
    c.description,
    c.last_modified,
    c.entity_tag,
    c.reissued_from
  FROM
    fby_projection p
  INNER JOIN fby_projection_entity pe ON pe.projection_id = p.id
  INNER JOIN fby_entity e ON e.id = pe.entity_id
  INNER JOIN fby_change_set_entity ce ON ce.entity_id = pe.entity_id
  INNER JOIN fby_change_set c ON c.id = ce.change_set_id
  WHERE c.superseded_by IS NULL
);

END TRANSACTION;
