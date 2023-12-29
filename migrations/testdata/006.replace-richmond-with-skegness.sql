DO $$ 

DECLARE
  v_change_set_id INTEGER;

BEGIN

  SELECT rdf_add_change_set('2021-06-01T00:00:00Z', 'Replace Richmond with Skegness') INTO v_change_set_id;

  PERFORM delete_park_v1(v_change_set_id, 'RI');
  PERFORM put_park_v1(v_change_set_id, 'SK', 'Skegness');

END $$;