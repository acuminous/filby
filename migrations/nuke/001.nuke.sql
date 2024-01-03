START TRANSACTION;

-- Custom Teardown
DROP FUNCTION IF EXISTS get_park_calendar_v1_aggregate;
DROP FUNCTION IF EXISTS put_park_calendar_v1_frame;
DROP FUNCTION IF EXISTS delete_park_calendar_v1_frame;

DROP FUNCTION IF EXISTS get_park_v1;
DROP FUNCTION IF EXISTS get_park_v1_aggregate;
DROP FUNCTION IF EXISTS put_park_v1_frame;
DROP FUNCTION IF EXISTS delete_park_v1_frame;

DROP TABLE IF EXISTS park_calendar_v1;
DROP TABLE IF EXISTS park_v1;

DROP TYPE IF EXISTS park_calendar_event_type;

-- RDF Teardown
DROP FUNCTION IF EXISTS rdf_add_data_frame;
DROP FUNCTION IF EXISTS rdf_add_change_set;
DROP FUNCTION IF EXISTS rdf_schedule_notification;
DROP FUNCTION IF EXISTS rdf_notify;
DROP FUNCTION IF EXISTS rdf_notify_entity_change;
DROP FUNCTION IF EXISTS rdf_get_next_notification;
DROP FUNCTION IF EXISTS rdf_pass_notification;
DROP FUNCTION IF EXISTS rdf_fail_notification;
DROP FUNCTION IF EXISTS rdf_add_webhook;
DROP FUNCTION IF EXISTS rdf_add_projection_dependency;
DROP FUNCTION IF EXISTS rdf_add_projection;
DROP FUNCTION IF EXISTS rdf_add_entity;

DROP VIEW IF EXISTS rdf_projection_change_log_vw;

DROP TABLE IF EXISTS rdf_data_frame;
DROP TABLE IF EXISTS rdf_change_set;
DROP TABLE IF EXISTS rdf_notification;
DROP TABLE IF EXISTS rdf_webhook;
DROP TABLE IF EXISTS rdf_projection_entity;
DROP TABLE IF EXISTS rdf_projection;
DROP TABLE IF EXISTS rdf_entity;

DROP TYPE IF EXISTS rdf_action_type;
DROP TYPE IF EXISTS rdf_notification_status;
DROP TYPE IF EXISTS rdf_entity_table_type;

DROP EXTENSION IF EXISTS pgcrypto;

DELETE FROM migrations;

END TRANSACTION;