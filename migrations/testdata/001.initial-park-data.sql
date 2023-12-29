START TRANSACTION;

DELETE FROM park_calendar_v1_data_frame;
DELETE FROM park_v1_data_frame;
DELETE FROM rdf_change_set;
DELETE FROM rdf_notification;
DELETE FROM rdf_webhook;
DELETE FROM rdf_projection_entity;
DELETE FROM rdf_projection;
DELETE FROM rdf_entity;

ALTER SEQUENCE IF EXISTS rdf_change_set_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  park_v1_data_frame_frame_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  park_calendar_v1_data_frame_frame_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  rdf_webhook_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  rdf_notification_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  rdf_projection_entity_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  rdf_projection_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS  rdf_entity_id_seq RESTART WITH 1;

INSERT INTO rdf_entity (id, name, version) VALUES 
(1, 'park', 1),
(2, 'park_calendar', 1);

INSERT INTO rdf_projection (id, name, version) VALUES 
(1, 'park', 1);

INSERT INTO rdf_projection_entity (projection_id, entity_id) VALUES 
(1, 1),
(1, 2);

INSERT INTO rdf_change_set (id, effective_from, notes) VALUES 
(1, '2019-01-01T00:00:00Z', 'Initial park data');

INSERT INTO park_v1_data_frame (rdf_change_set_id, rdf_action, code, name) VALUES 
(1, 'PUT', 'DC', 'Devon Hills'),
(1, 'PUT', 'PV', 'Primrose Valley'),
(1, 'PUT', 'GA', 'Greenacres');

INSERT INTO park_calendar_v1_data_frame (rdf_change_set_id, rdf_action, park_code, event, occurs) VALUES 
(1, 'PUT', 'DC', 'Park Open - Owners', '2019-03-01T00:00:00Z'),
(1, 'PUT', 'DC', 'Park Open - Guests', '2019-03-15T00:00:00Z'),
(1, 'PUT', 'DC', 'Park Close - Owners', '2019-11-30T00:00:00Z'),
(1, 'PUT', 'DC', 'Park Close - Guests', '2019-11-15T00:00:00Z'),

(1, 'PUT', 'PV', 'Park Open - Owners', '2019-03-01T00:00:00Z'),
(1, 'PUT', 'PV', 'Park Open - Guests', '2019-03-15T00:00:00Z'),
(1, 'PUT', 'PV', 'Park Close - Owners', '2019-11-30T00:00:00Z'),
(1, 'PUT', 'PV', 'Park Close - Guests', '2019-11-15T00:00:00Z'),

(1, 'PUT', 'GA', 'Park Open - Owners', '2019-03-01T00:00:00Z'),
(1, 'PUT', 'GA', 'Park Open - Guests', '2019-03-15T00:00:00Z'),
(1, 'PUT', 'GA', 'Park Close - Owners', '2019-11-30T00:00:00Z'),
(1, 'PUT', 'GA', 'Park Close - Guests', '2019-11-15T00:00:00Z');

INSERT INTO rdf_webhook (projection_id, url) VALUES 
(1, 'https://httpbin.org/status/500'),
(1, 'https://httpbin.org/status/200');

SELECT rdf_notify_entity_change(ARRAY[
  ('park', 1), 
  ('park_calendar', 1)
]::rdf_entity_table_type[]);

END TRANSACTION;