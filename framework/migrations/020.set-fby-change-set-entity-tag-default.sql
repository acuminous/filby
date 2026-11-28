START TRANSACTION;

ALTER TABLE fby_change_set ALTER COLUMN entity_tag SET DEFAULT left(replace(gen_random_uuid()::TEXT, '-', ''), 20);

END TRANSACTION;
