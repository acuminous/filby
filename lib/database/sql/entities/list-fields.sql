SELECT name, type, identity AS key, nullable, since FROM fby_entity_field WHERE entity_id = $1 ORDER BY position;
