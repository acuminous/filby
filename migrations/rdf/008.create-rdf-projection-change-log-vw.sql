START TRANSACTION;

CREATE VIEW rdf_projection_change_log_vw AS (
  SELECT DISTINCT ON (c.id)
    p.id AS projection_id,
    p.name AS projection_name,
    p.version AS projection_version,  
    c.id AS change_set_id,
    c.effective_from,
    c.notes,
    c.last_modified,
    c.entity_tag
  FROM
    rdf_projection p
  INNER JOIN rdf_projection_entity pe ON pe.projection_id = p.id
  INNER JOIN rdf_entity e ON e.id = pe.entity_id
  INNER JOIN rdf_data_frame f ON f.entity_id = pe.entity_id
  INNER JOIN rdf_change_set c ON c.id = f.change_set_id
);

END TRANSACTION;