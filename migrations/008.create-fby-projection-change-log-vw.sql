START TRANSACTION;

CREATE VIEW fby_projection_change_log_vw AS (
  SELECT
    p.id AS projection_id,
    p.name AS projection_name,
    p.version AS projection_version,
    c.id AS change_set_id,
    c.effective,
    c.description,
    c.last_modified,
    c.entity_tag
  FROM
    fby_projection p
  INNER JOIN fby_projection_entity pe ON pe.projection_id = p.id
  INNER JOIN fby_entity e ON e.id = pe.entity_id
  INNER JOIN fby_data_frame f ON f.entity_id = pe.entity_id
  INNER JOIN fby_change_set c ON c.id = f.change_set_id
);

END TRANSACTION;