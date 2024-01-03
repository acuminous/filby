DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2020-02-01T00:00:00Z', 'Rename Devon Hills to Devon Cliffs') INTO v_change_set_id;
  
  PERFORM put_park_v1_frame(v_change_set_id, 'DC', 'Devon Cliffs');

END $$;