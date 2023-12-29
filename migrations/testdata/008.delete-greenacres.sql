DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2022-05-01T00:00:00Z', 'Delete Greenacres') INTO v_change_set_id;

  PERFORM delete_park_v1(v_change_set_id, 'GA');

END $$;