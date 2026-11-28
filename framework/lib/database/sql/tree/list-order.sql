SELECT projection_id, field, direction, nulls FROM fby_projection_order WHERE $1::INTEGER IS NULL OR projection_id = $1 ORDER BY projection_id, position;
