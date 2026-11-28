SELECT
  COUNT(*) FILTER (WHERE status = 'PENDING')::INTEGER AS pending,
  COUNT(*) FILTER (WHERE status = 'CLAIMED')::INTEGER AS claimed,
  COUNT(*) FILTER (WHERE status = 'PENDING' AND scheduled_for < now() AND attempts < $1)::INTEGER AS overdue,
  COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts >= $1)::INTEGER AS exhausted
FROM fby_notification;
