DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2020-01-01T00:00:00Z', 'Park Calendars - 2020') INTO v_change_set_id;

  PERFORM put_park_calendar_v1(v_change_set_id, 13, 'DC', 'Park Open - Owners', '2020-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 14, 'DC', 'Park Open - Guests', '2020-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 15, 'DC', 'Park Close - Owners', '2020-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 16, 'DC', 'Park Close - Guests', '2020-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 17, 'PV', 'Park Open - Owners', '2020-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 18, 'PV', 'Park Open - Guests', '2020-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 19, 'PV', 'Park Close - Owners', '2020-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 20, 'PV', 'Park Close - Guests', '2020-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 21, 'GA', 'Park Open - Owners', '2020-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 22, 'GA', 'Park Open - Guests', '2020-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 23, 'GA', 'Park Close - Owners', '2020-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 24, 'GA', 'Park Close - Guests', '2020-11-15T00:00:00Z');

END $$;