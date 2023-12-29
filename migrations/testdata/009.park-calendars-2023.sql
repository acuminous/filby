START TRANSACTION;

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(10, '2020-01-01T00:00:00Z', 'Park Calendars - 2023');

INSERT INTO park_calendar_v1_data_frame (rdf_change_set_id, rdf_action, park_code, event, occurs) VALUES 
(10, 'PUT', 'DC', 'Park Open - Owners', '2023-03-01 00:00:00Z'),
(10, 'PUT', 'DC', 'Park Open - Guests', '2023-03-15 00:00:00Z'),
(10, 'PUT', 'DC', 'Park Close - Owners', '2023-11-30 00:00:00Z'),
(10, 'PUT', 'DC', 'Park Close - Guests', '2023-11-15 00:00:00Z'),

(10, 'PUT', 'PV', 'Park Open - Owners', '2023-03-01 00:00:00Z'),
(10, 'PUT', 'PV', 'Park Open - Guests', '2023-03-15 00:00:00Z'),
(10, 'PUT', 'PV', 'Park Close - Owners', '2023-11-30 00:00:00Z'),
(10, 'PUT', 'PV', 'Park Close - Guests', '2023-11-15 00:00:00Z'),

(10, 'PUT', 'SK', 'Park Open - Owners', '2023-03-01 00:00:00Z'),
(10, 'PUT', 'SK', 'Park Open - Guests', '2023-03-15 00:00:00Z'),
(10, 'PUT', 'SK', 'Park Close - Owners', '2023-11-30 00:00:00Z'),
(10, 'PUT', 'SK', 'Park Close - Guests', '2023-11-15 00:00:00Z');

SELECT rdf_notify_entity_change(ARRAY[
  ('park_calendar', 1)
]::rdf_entity_table_type[]);

END TRANSACTION;
