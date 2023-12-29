DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2020-01-01T00:00:00Z', 'Park Calendars - 2022') INTO v_change_set_id;

  PERFORM put_park_calendar_v1(v_change_set_id, 41, 'DC', 'Park Open - Owners', '2022-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 42, 'DC', 'Park Open - Guests', '2022-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 43, 'DC', 'Park Close - Owners', '2022-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 44, 'DC', 'Park Close - Guests', '2022-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 45, 'PV', 'Park Open - Owners', '2022-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 46, 'PV', 'Park Open - Guests', '2022-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 47, 'PV', 'Park Close - Owners', '2022-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 48, 'PV', 'Park Close - Guests', '2022-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 49, 'GA', 'Park Open - Owners', '2022-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 50, 'GA', 'Park Open - Guests', '2022-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 51, 'GA', 'Park Close - Owners', '2022-04-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 52, 'GA', 'Park Close - Guests', '2022-04-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 53, 'SK', 'Park Open - Owners', '2022-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 54, 'SK', 'Park Open - Guests', '2022-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 55, 'SK', 'Park Close - Owners', '2022-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 56, 'SK', 'Park Close - Guests', '2022-11-15T00:00:00Z');

END $$;