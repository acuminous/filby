START TRANSACTION;

ALTER TABLE fby_entity_field ADD COLUMN nullable BOOLEAN;

UPDATE fby_entity_field SET nullable = NOT identity;

ALTER TABLE fby_entity_field ALTER COLUMN nullable SET NOT NULL;

END TRANSACTION;
