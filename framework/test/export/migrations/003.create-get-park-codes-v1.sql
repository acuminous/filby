CREATE FUNCTION get_park_codes_v1(p_change_set_id INTEGER) RETURNS TABLE (code TEXT, opened TIMESTAMP WITH TIME ZONE) AS $$
  SELECT code, opened FROM get_park_v1_aggregate(p_change_set_id) ORDER BY code;
$$ LANGUAGE sql STABLE;
