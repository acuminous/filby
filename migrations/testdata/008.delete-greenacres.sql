START TRANSACTION;

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(8, '2022-05-01T00:00:00Z', 'Delete Greenacres');

INSERT INTO park_v1_data_frame (rdf_change_set_id, rdf_action, code, name) VALUES 
(8, 'DELETE', 'GA', 'Greenacres');

SELECT rdf_notify_entity_change(ARRAY[
  ('park', 1)
]::rdf_entity_table_type[]);

END TRANSACTION;