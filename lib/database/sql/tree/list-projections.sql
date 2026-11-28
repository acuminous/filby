SELECT p.id, p.name, p.version, p.description, p.root_entity_id, e.name AS root_name, e.version AS root_version, p.fields AS selection, p.aliases, p.fields_since, p.page_size, p.page_max
FROM fby_projection p
LEFT JOIN fby_entity e ON e.id = p.root_entity_id
WHERE p.dropped_at IS NULL AND ($1::INTEGER IS NULL OR p.id = $1)
ORDER BY p.name, p.version;
