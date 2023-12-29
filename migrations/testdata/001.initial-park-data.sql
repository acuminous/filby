DO $$ 

DECLARE
  v_park_projection_id INTEGER;
  v_change_set_id INTEGER;
  
BEGIN

  PERFORM rdf_add_entity('park', 1);
  PERFORM rdf_add_entity('park_calendar', 1);

  SELECT rdf_add_projection('park', 1) INTO v_park_projection_id;
  PERFORM rdf_add_projection_dependency(v_park_projection_id, 'park', 1);
  PERFORM rdf_add_projection_dependency(v_park_projection_id, 'park_calendar', 1);

  PERFORM rdf_add_webhook(v_park_projection_id, 'https://httpbin.org/status/500');
  PERFORM rdf_add_webhook(v_park_projection_id, 'https://httpbin.org/status/200');

  SELECT rdf_add_change_set('2019-01-01T00:00:00Z', 'Initial park data') INTO v_change_set_id;

  PERFORM put_park_v1(v_change_set_id, 'DC', 'Devon Hills');
  PERFORM put_park_v1(v_change_set_id, 'PV', 'Primrose Valley');
  PERFORM put_park_v1(v_change_set_id, 'GA', 'Greenacres'); 

  PERFORM put_park_calendar_v1(v_change_set_id, 1, 'DC', 'Park Open - Owners', '2019-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 2, 'DC', 'Park Open - Guests', '2019-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 3, 'DC', 'Park Close - Owners', '2019-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 4, 'DC', 'Park Close - Guests', '2019-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 5, 'PV', 'Park Open - Owners', '2019-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 6, 'PV', 'Park Open - Guests', '2019-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 7, 'PV', 'Park Close - Owners', '2019-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 8, 'PV', 'Park Close - Guests', '2019-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 9,  'GA', 'Park Open - Owners', '2019-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 10, 'GA', 'Park Open - Guests', '2019-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 11, 'GA', 'Park Close - Owners', '2019-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 12, 'GA', 'Park Close - Guests', '2019-11-15T00:00:00Z');

END $$;
