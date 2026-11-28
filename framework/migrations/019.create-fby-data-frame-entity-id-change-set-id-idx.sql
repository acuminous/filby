START TRANSACTION;

CREATE INDEX fby_data_frame_entity_id_change_set_id_idx ON fby_data_frame (entity_id, change_set_id);

END TRANSACTION;
