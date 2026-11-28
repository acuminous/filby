SELECT name, ARRAY_AGG(value ORDER BY position) AS values
FROM fby_enum
WHERE $1::TEXT IS NULL OR name = $1
GROUP BY name
ORDER BY name;
