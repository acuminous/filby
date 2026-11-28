SELECT h.id, h.name, h.event, p.name AS projection_name, p.version AS projection_version
FROM fby_hook h
LEFT JOIN fby_projection p ON p.id = h.projection_id
WHERE $1::TEXT IS NULL OR h.name = $1
ORDER BY h.name;
