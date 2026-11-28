SELECT n.id, h.name AS hook_name, h.event AS hook_event, n.attempts, n.projection_name, n.projection_version
FROM fby_get_next_notification($1, $2) n
INNER JOIN fby_hook h ON h.id = n.hook_id;
