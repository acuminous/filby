CREATE FUNCTION get_park_v1(p_change_set_id INTEGER)
RETURNS TABLE (
  code TEXT,
  name TEXT,
  calendar_event park_calendar_event_type,
  calendar_occurs TIMESTAMP WITH TIME ZONE
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.code,
    p.name,
    pc.event AS calendar_event,
    pc.occurs AS calendar_occurs
  FROM 
    get_park_v1_aggregate(p_change_set_id) p
  LEFT JOIN get_park_calendar_v1_aggregate(p_change_set_id) pc ON pc.park_code = p.code
  WHERE p.rdf_action <> 'DELETE' AND pc.rdf_action <> 'DELETE'  
  ORDER BY
    code ASC,
    occurs ASC;
END;
$$ LANGUAGE plpgsql IMMUTABLE;