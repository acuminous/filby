SELECT h.name, h.description, h.event, p.name AS projection_name, p.version AS projection_version
FROM fby_hook h
LEFT JOIN fby_projection p ON p.id = h.projection_id
WHERE h.name = $1;
