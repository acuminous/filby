# Changelog

## Unreleased

### Upgrading

Upgrade and restart. Filby applies its own migrations when `init()` is called, and regenerates existing aggregate functions with the new ordering and `LANGUAGE sql STABLE` body. No data is changed.

#### More than one frame with the same key in a change set

Entity tables now allow only one frame per key in each change set. If an existing change set breaks this rule, the upgrade stops, nothing is applied, `init()` rejects, and the error names the first duplicate:

```
Entity 'VAT Rate v1' has more than one frame with key (type=standard) in change set '2021 VAT Rates'
HINT: Keep one frame per key in each change set. See the CHANGELOG for a query that lists every duplicate.
```

To list every duplicate for an entity, substitute its table and key columns:

```sql
SELECT cs.id AS change_set_id, cs.description, x.type, COUNT(*) AS frames, MAX(x.fby_frame_id) AS winning_frame_id
FROM vat_rate_v1 x
INNER JOIN fby_data_frame f ON f.id = x.fby_frame_id
INNER JOIN fby_change_set cs ON cs.id = f.change_set_id
GROUP BY cs.id, cs.description, x.type
HAVING COUNT(*) > 1
ORDER BY cs.id;
```

Previously the frame with the highest id won, so you can safely keep that frame and delete the others for the same key and change set. Delete each frame's entity row first, then its `fby_data_frame` row. Filby does not delete your data for you.

### Changed

- Aggregate functions select, for each key, the frame from the change set with the latest effective date rather than the most recently added frame. Previously, backfilling a change set dated before an existing one overrode the later values (#3).
- A change set may contain only one frame per key for each entity, whether the frames set or delete it. Entity tables gain `fby_change_set_id`, `UNIQUE (fby_change_set_id, <key columns>)` replaces the old unique constraint (which could never fail), and key columns are `NOT NULL` (#6).
- Entity tables reference `fby_data_frame` with `ON DELETE CASCADE`, so deleting a change set with SQL also deletes its entity rows (#6, #25).
- Aggregate functions are generated as `LANGUAGE sql STABLE`, so Postgres can inline them and apply the caller's filters before the aggregate is materialised (#36).

### Added

- Entity definitions are recorded in `fby_entity_field`, `fby_entity_check` and `fby_enum`. Existing entities and enums are backfilled on upgrade (#3).
