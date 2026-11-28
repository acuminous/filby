CREATE FUNCTION get_park_codes_v1(p_change_set_id INTEGER)
RETURNS TABLE (
  code TEXT
)
AS $$
  SELECT p.code
  FROM get_park_v1_aggregate(p_change_set_id) p
  ORDER BY p.code ASC;
$$ LANGUAGE sql STABLE;
