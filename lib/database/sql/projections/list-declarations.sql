SELECT p.name, p.version, p.description, e.name AS root_name, e.version AS root_version
FROM fby_projection p
LEFT JOIN fby_entity e ON e.id = p.root_entity_id
WHERE p.dropped_at IS NULL
ORDER BY p.name, p.version;
