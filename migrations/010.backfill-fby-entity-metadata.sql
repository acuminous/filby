START TRANSACTION;

CREATE TEMPORARY TABLE fby_entity_table ON COMMIT DROP AS
SELECT e.id AS entity_id, to_regclass(format('%I', lower(regexp_replace(e.name || ' v' || e.version, '\s', '_', 'g')))) AS table_oid
FROM fby_entity e;

INSERT INTO fby_entity_field (entity_id, position, name, type, identity)
SELECT
  t.entity_id,
  ROW_NUMBER() OVER (PARTITION BY t.entity_id ORDER BY a.attnum),
  a.attname,
  format_type(a.atttypid, a.atttypmod),
  COALESCE(a.attnum = ANY (u.conkey), FALSE)
FROM fby_entity_table t
INNER JOIN pg_attribute a ON a.attrelid = t.table_oid
LEFT JOIN (
  SELECT c.conrelid, c.conkey
  FROM pg_constraint c
  INNER JOIN pg_attribute frame_id ON frame_id.attrelid = c.conrelid AND frame_id.attname = 'fby_frame_id'
  WHERE c.contype = 'u'
    AND frame_id.attnum = ANY (c.conkey)
) u ON u.conrelid = t.table_oid
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname <> 'fby_frame_id';

INSERT INTO fby_entity_check (entity_id, name, expression)
SELECT
  t.entity_id,
  regexp_replace(c.conname, '^chk_', ''),
  regexp_replace(pg_get_constraintdef(c.oid), '^CHECK ', '')
FROM fby_entity_table t
INNER JOIN pg_constraint c ON c.conrelid = t.table_oid
WHERE c.contype = 'c';

INSERT INTO fby_enum (name, position, value)
SELECT
  t.typname,
  ROW_NUMBER() OVER (PARTITION BY t.oid ORDER BY e.enumsortorder),
  e.enumlabel
FROM pg_type t
INNER JOIN pg_enum e ON e.enumtypid = t.oid
INNER JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = current_schema()
  AND t.typname NOT LIKE 'fby\_%';

END TRANSACTION;
