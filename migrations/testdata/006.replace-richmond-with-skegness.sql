START TRANSACTION;

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(6, '2021-06-01T00:00:00Z', 'Replace Richmond with Skegness');

INSERT INTO park_v1_data_frame (rdf_change_set_id, rdf_action, code, name) VALUES 
(6, 'DELETE', 'RI', 'Richmond'),
(6, 'PUT', 'SK', 'Skegness');

SELECT rdf_notify_entity_change(ARRAY[
  ('park', 1)
]::rdf_entity_table_type[]);

END TRANSACTION;