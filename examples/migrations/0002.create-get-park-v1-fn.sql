CREATE FUNCTION get_park_v1(p_change_set_id INTEGER)
RETURNS TABLE (
  code TEXT,
  name TEXT,
  season_type season_type,
  season_start TIMESTAMP WITH TIME ZONE,
  season_end TIMESTAMP WITH TIME ZONE
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.code,
    p.name,
    s.type AS season_type,
    s.start AS season_start,
    s.end AS season_end
  FROM
    get_park_v1_aggregate(p_change_set_id) p
  LEFT JOIN
    get_season_v1_aggregate(p_change_set_id) s ON s.park_code = p.code
  ORDER BY
    p.code ASC,
    s.start DESC,
    s.type ASC;
END;
$$ LANGUAGE plpgsql IMMUTABLE;