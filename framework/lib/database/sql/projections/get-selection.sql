SELECT id, root_entity_id, aliases, fields_since, page_size, page_max FROM fby_projection WHERE name = $1 AND version = $2 AND dropped_at IS NULL;
