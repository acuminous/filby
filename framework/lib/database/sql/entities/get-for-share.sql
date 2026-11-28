SELECT id, name, version, description FROM fby_entity WHERE name = $1 AND version = $2 FOR SHARE;
