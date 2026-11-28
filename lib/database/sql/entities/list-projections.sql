SELECT p.name, p.version
FROM fby_projection p
INNER JOIN fby_projection_entity pe ON pe.projection_id = p.id
WHERE pe.entity_id = $1
  AND p.dropped_at IS NULL
ORDER BY p.name, p.version;
