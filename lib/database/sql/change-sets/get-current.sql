SELECT change_set_id, effective, description, last_modified, entity_tag, reissued_from
FROM fby_projection_change_log_vw
WHERE projection_id = $1 AND effective <= now()
ORDER BY effective DESC, change_set_id DESC
LIMIT 1;
