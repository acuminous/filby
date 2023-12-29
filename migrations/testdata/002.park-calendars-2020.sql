START TRANSACTION;

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(2, '2020-01-01T00:00:00Z', 'Park Calendars - 2020');

INSERT INTO park_calendar_v1_data_frame (rdf_change_set_id, rdf_action, park_code, event, occurs) VALUES 
(2, 'PUT', 'DC', 'Park Open - Owners', '2020-03-01T00:00:00Z'),
(2, 'PUT', 'DC', 'Park Open - Guests', '2020-03-15T00:00:00Z'),
(2, 'PUT', 'DC', 'Park Close - Owners', '2020-11-30T00:00:00Z'),
(2, 'PUT', 'DC', 'Park Close - Guests', '2020-11-15T00:00:00Z'),

(2, 'PUT', 'PV', 'Park Open - Owners', '2020-03-01T00:00:00Z'),
(2, 'PUT', 'PV', 'Park Open - Guests', '2020-03-15T00:00:00Z'),
(2, 'PUT', 'PV', 'Park Close - Owners', '2020-11-30T00:00:00Z'),
(2, 'PUT', 'PV', 'Park Close - Guests', '2020-11-15T00:00:00Z'),

(2, 'PUT', 'GA', 'Park Open - Owners', '2020-03-01T00:00:00Z'),
(2, 'PUT', 'GA', 'Park Open - Guests', '2020-03-15T00:00:00Z'),
(2, 'PUT', 'GA', 'Park Close - Owners', '2020-11-30T00:00:00Z'),
(2, 'PUT', 'GA', 'Park Close - Guests', '2020-11-15T00:00:00Z');

SELECT rdf_notify_entity_change(ARRAY[
  ('park_calendar', 1)
]::rdf_entity_table_type[]);

END TRANSACTION;