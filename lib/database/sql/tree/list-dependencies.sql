SELECT pe.projection_id, e.name, e.version
FROM fby_projection_entity pe
INNER JOIN fby_entity e ON e.id = pe.entity_id
WHERE $1::INTEGER IS NULL OR pe.projection_id = $1
ORDER BY e.name, e.version;
