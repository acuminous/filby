SELECT n.id, n.projection_id, n.parent_nest_id, n.name, n.entity_id, e.name AS entity_name, e.version AS entity_version, n.lookup, n.fields AS selection, n.aliases, n.fields_since, n.since
FROM fby_projection_nest n
INNER JOIN fby_entity e ON e.id = n.entity_id
WHERE $1::INTEGER IS NULL OR n.projection_id = $1
ORDER BY n.projection_id, n.position;
