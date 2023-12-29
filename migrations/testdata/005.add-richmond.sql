DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2021-04-01T00:00:00Z', 'Add Richmond') INTO v_change_set_id;

  PERFORM put_park_v1(v_change_set_id, 'RI', 'Richmond');

  PERFORM put_park_calendar_v1(v_change_set_id, 37, 'RI', 'Park Open - Owners', '2021-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 38, 'RI', 'Park Open - Guests', '2021-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 39, 'RI', 'Park Close - Owners', '2021-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 40, 'RI', 'Park Close - Guests', '2021-11-15T00:00:00Z');

END $$;