SELECT id AS change_set_id, effective, description, last_modified, entity_tag, reissued_from FROM fby_change_set WHERE id = $1;
