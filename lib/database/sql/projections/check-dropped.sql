SELECT 1 FROM fby_projection WHERE name = $1 AND version = $2 AND dropped_at IS NOT NULL;
