START TRANSACTION;

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(5, '2021-04-01T00:00:00Z', 'Add Richmond');

INSERT INTO park_v1_data_frame (rdf_change_set_id, rdf_action, code, name) VALUES 
(5, 'PUT', 'RI', 'Richmond');

INSERT INTO park_calendar_v1_data_frame (rdf_change_set_id, rdf_action, park_code, event, occurs) VALUES 
(5, 'PUT', 'RI', 'Park Open - Owners', '2021-03-01T00:00:00Z'),
(5, 'PUT', 'RI', 'Park Open - Guests', '2021-03-15T00:00:00Z'),
(5, 'PUT', 'RI', 'Park Close - Owners', '2021-11-30T00:00:00Z'),
(5, 'PUT', 'RI', 'Park Close - Guests', '2021-11-15T00:00:00Z');

SELECT rdf_notify_entity_change(ARRAY[
  ('park', 1),
  ('park_calendar', 1)
 ]::rdf_entity_table_type[]);

END TRANSACTION;