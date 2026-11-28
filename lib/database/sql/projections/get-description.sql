SELECT description FROM fby_projection WHERE id = $1 AND dropped_at IS NULL;
