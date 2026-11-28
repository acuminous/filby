SELECT hook_id, projection_name, projection_version, status, scheduled_for, attempts, last_attempted
FROM fby_notification
WHERE hook_id = ANY($1)
ORDER BY projection_name, projection_version, scheduled_for, id;
