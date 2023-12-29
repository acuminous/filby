START TRANSACTION;

-- Custom Teardown
DROP FUNCTION IF EXISTS get_park_v1_fn;

DROP VIEW IF EXISTS park_v1_changelog_vw;
DROP TABLE IF EXISTS park_calendar_v1_data_frame;
DROP TABLE IF EXISTS park_v1_data_frame;
DROP TABLE IF EXISTS rdf_change_set;
DROP TABLE IF EXISTS rdf_notification;
DROP TABLE IF EXISTS rdf_webhook;
DROP TABLE IF EXISTS rdf_projection_entity;
DROP TABLE IF EXISTS rdf_projection;
DROP TABLE IF EXISTS rdf_entity;

DROP TYPE IF EXISTS park_calendar_event_type;

-- RDF Teardown

DROP TRIGGER IF EXISTS rdf_track_change_set_changes_tr ON rdf_change_set;

DROP FUNCTION IF EXISTS rdf_schedule_notification;
DROP FUNCTION IF EXISTS rdf_notify_entity_change;
DROP FUNCTION IF EXISTS rdf_get_next_notification;
DROP FUNCTION IF EXISTS rdf_pass_notification;
DROP FUNCTION IF EXISTS rdf_fail_notification;
DROP FUNCTION IF EXISTS rdf_track_change_set_changes_fn;


DROP TABLE IF EXISTS rdf_notification;
DROP TABLE IF EXISTS rdf_webhook;
DROP TABLE IF EXISTS rdf_projection_entity;
DROP TABLE IF EXISTS rdf_entity;
DROP TABLE IF EXISTS rdf_projection;
DROP TABLE IF EXISTS rdf_change_set;

DROP TYPE IF EXISTS rdf_action_type;
DROP TYPE IF EXISTS rdf_notification_status;
DROP TYPE IF EXISTS rdf_entity_table_type;

DROP EXTENSION IF EXISTS pgcrypto;

DELETE FROM migrations;

END TRANSACTION;