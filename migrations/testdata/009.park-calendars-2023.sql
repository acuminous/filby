DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2020-01-01T00:00:00Z', 'Park Calendars - 2023') INTO v_change_set_id; 

  PERFORM put_park_calendar_v1(v_change_set_id, 57, 'DC', 'Park Open - Owners', '2023-03-01 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 58, 'DC', 'Park Open - Guests', '2023-03-15 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 59, 'DC', 'Park Close - Owners', '2023-11-30 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 60, 'DC', 'Park Close - Guests', '2023-11-15 00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 61, 'PV', 'Park Open - Owners', '2023-03-01 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 62, 'PV', 'Park Open - Guests', '2023-03-15 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 63, 'PV', 'Park Close - Owners', '2023-11-30 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 64, 'PV', 'Park Close - Guests', '2023-11-15 00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 65, 'SK', 'Park Open - Owners', '2023-03-01 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 66, 'SK', 'Park Open - Guests', '2023-03-15 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 67, 'SK', 'Park Close - Owners', '2023-11-30 00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 68, 'SK', 'Park Close - Guests', '2023-11-15 00:00:00Z');

END $$;
