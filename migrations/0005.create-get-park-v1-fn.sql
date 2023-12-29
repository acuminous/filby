CREATE FUNCTION get_park_v1_fn(p_change_set_id INTEGER)
RETURNS TABLE (
  code TEXT,
  name TEXT,
  calendar_event park_calendar_event_type,
  calendar_occurs TIMESTAMP WITH TIME ZONE
)
AS $$
BEGIN
  RETURN QUERY
  WITH squashed_park_v1_data_frame AS (
    SELECT
      DISTINCT ON (code) *
    FROM 
      park_v1_data_frame park
    WHERE
      park.rdf_change_set_id <= p_change_set_id
    ORDER BY
      code, 
      frame_id DESC
  ), squashed_park_calendar_v1_data_frame AS (
    SELECT
      DISTINCT ON (park_code, event) *
    FROM 
      park_calendar_v1_data_frame park_calendar
    WHERE
      park_calendar.rdf_change_set_id <= p_change_set_id
    ORDER BY
      park_code, 
      event, 
      frame_id DESC
  )
  SELECT
    park.code,
    park.name,
    park_calendar.event AS calendar_event,
    park_calendar.occurs AS calendar_occurs
  FROM 
    squashed_park_v1_data_frame park
  LEFT JOIN
    squashed_park_calendar_v1_data_frame park_calendar
  ON
    park_calendar.park_code = park.code
  WHERE
    park.rdf_action <> 'DELETE'
  AND
    park_calendar.rdf_action <> 'DELETE'  
  ORDER BY
    code ASC,
    occurs ASC;
END;
$$ LANGUAGE plpgsql;