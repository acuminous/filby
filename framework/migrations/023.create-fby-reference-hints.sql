START TRANSACTION;

CREATE OR REPLACE FUNCTION fby_entity_hint(p_name TEXT, p_version INTEGER) RETURNS TEXT
AS $$
  SELECT COALESCE(
    (SELECT '; did you mean ' || string_agg('''' || name || ' v' || version || '''', ', ' ORDER BY name) || '?' FROM fby_entity WHERE lower(name) = lower(p_name) AND version = p_version),
    (SELECT '; existing entities are ' || string_agg('''' || name || ' v' || version || '''', ', ' ORDER BY name, version) FROM fby_entity),
    '; no entities exist'
  );
$$ LANGUAGE sql STABLE;

END TRANSACTION;
