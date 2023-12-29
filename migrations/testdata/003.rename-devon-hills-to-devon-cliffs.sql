START TRANSACTION;

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(3, '2020-02-01T00:00:00Z', 'Rename Devon Hills to Devon Cliffs');

INSERT INTO park_v1_data_frame (rdf_change_set_id, rdf_action, code, name) VALUES 
(3, 'PUT', 'DC', 'Devon Cliffs');

SELECT rdf_notify_entity_change(ARRAY[
  ('park', 1)
]::rdf_entity_table_type[]);

END TRANSACTION;