START TRANSACTION;

DO $$
DECLARE
  v_change_set_id INTEGER;
BEGIN
  SELECT min(id) INTO v_change_set_id FROM fby_change_set;
  WHILE v_change_set_id IS NOT NULL LOOP
    PERFORM fby_reissue_change_sets(v_change_set_id);
    SELECT min(id) INTO v_change_set_id FROM fby_change_set WHERE id > v_change_set_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
