SELECT t.typarray FROM pg_type t WHERE t.typname IN (SELECT DISTINCT name FROM fby_enum);
