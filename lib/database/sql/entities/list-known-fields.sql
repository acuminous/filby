SELECT entity_id, name FROM fby_entity_field WHERE since IS NULL OR since <= $1 ORDER BY entity_id, position;
