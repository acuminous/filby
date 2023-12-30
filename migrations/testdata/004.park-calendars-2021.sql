DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2021-01-01T00:00:00Z', 'Park Calendars - 2021') INTO v_change_set_id;

  PERFORM delete_park_calendar_v1(v_change_set_id, 1);
  PERFORM delete_park_calendar_v1(v_change_set_id, 2);
  PERFORM delete_park_calendar_v1(v_change_set_id, 3);
  PERFORM delete_park_calendar_v1(v_change_set_id, 4);

  PERFORM delete_park_calendar_v1(v_change_set_id, 5);
  PERFORM delete_park_calendar_v1(v_change_set_id, 6);
  PERFORM delete_park_calendar_v1(v_change_set_id, 7);
  PERFORM delete_park_calendar_v1(v_change_set_id, 8);

  PERFORM delete_park_calendar_v1(v_change_set_id, 9);
  PERFORM delete_park_calendar_v1(v_change_set_id, 10);
  PERFORM delete_park_calendar_v1(v_change_set_id, 11);
  PERFORM delete_park_calendar_v1(v_change_set_id, 12);

  PERFORM put_park_calendar_v1(v_change_set_id, 25, 'DC', 'Park Open - Owners', '2021-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 26, 'DC', 'Park Open - Guests', '2021-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 27, 'DC', 'Park Close - Owners', '2021-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 28, 'DC', 'Park Close - Guests', '2021-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 29, 'PV', 'Park Open - Owners', '2021-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 30, 'PV', 'Park Open - Guests', '2021-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 31, 'PV', 'Park Close - Owners', '2021-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 32, 'PV', 'Park Close - Guests', '2021-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 33, 'GA', 'Park Open - Owners', '2021-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 34, 'GA', 'Park Open - Guests', '2021-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 35, 'GA', 'Park Close - Owners', '2021-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 36, 'GA', 'Park Close - Guests', '2021-11-15T00:00:00Z');

END $$;