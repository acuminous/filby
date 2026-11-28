SELECT projection_id, name, field, match, since FROM fby_projection_parameter WHERE $1::INTEGER IS NULL OR projection_id = $1 ORDER BY projection_id, position;
