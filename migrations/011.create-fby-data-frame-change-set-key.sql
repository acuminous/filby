START TRANSACTION;

ALTER TABLE fby_data_frame ADD CONSTRAINT uniq_fby_data_frame_id_change_set_id UNIQUE (id, change_set_id);

END TRANSACTION;
