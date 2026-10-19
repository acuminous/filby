# Changelog

## Unreleased

### Upgrading

Upgrade and restart. Filby applies its own migrations when `init()` is called, regenerates existing aggregate functions with the new ordering and `LANGUAGE sql STABLE` body, relabels existing `POST` frames as `SET`, re-issues change sets that are out of order, records which entities each existing change set touches in `fby_change_set_entity`, and replaces the default for `fby_change_set.entity_tag` with one that does not use pgcrypto. No other data is changed.

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

#### Change sets that are out of order

If an existing change set has a later effective date than a change set added after it, typically because it was pre-released, the upgrade re-issues it as a new change set, just as adding the later change set would now do. See [Correcting and Re-issuing Data](README.md#correcting-and-re-issuing-data). The change log may therefore gain entries, the originals drop out of it, and `ADD_CHANGE_SET` notifications are scheduled for the re-issued change sets. The originals are still returned by `getChangeSet` and `getAggregates` with their original results (#100).

#### SQL that uses the POST action

The `POST` value of `fby_action_type` is renamed to `SET`. YAML, JSON and CSV migrations that use `POST` keep working, but your own SQL that uses the literal `'POST'` must change to `'SET'`. This includes custom functions, views and raw SQL migrations that insert data frames. Replaying such a raw SQL migration against a fresh database fails, because the value no longer exists.

### Changed

- Aggregate functions select, for each key, the frame from the change set with the latest effective date rather than the most recently added frame. Previously, backfilling a change set dated before an existing one overrode the later values (#3).
- A change set may contain only one frame per key for each entity, whether the frames set or delete it. Entity tables gain `fby_change_set_id`, `UNIQUE (fby_change_set_id, <key columns>)` replaces the old unique constraint (which could never fail), and key columns are `NOT NULL` (#6).
- Entity tables reference `fby_data_frame` with `ON DELETE CASCADE`, so deleting a change set with SQL also deletes its entity rows. A superseded change set and its re-issue must be deleted in the same statement. See [Correcting and Re-issuing Data](README.md#correcting-and-re-issuing-data) (#6, #25).
- The `POST` frame action is renamed to `SET`, in the DSL and in the database. `POST` is also accepted in YAML, JSON and CSV, and is stored as `SET` (#77).
- Aggregate functions are generated as `LANGUAGE sql STABLE`, so Postgres can inline them and apply the caller's filters before the aggregate is materialised (#36).
- Adding a change set re-issues every live change set with a later effective date as a new change set with the same description, effective date and data frames, and marks the original as superseded, so change set ids always follow effective dates. One migration can therefore add more than one change log entry, and each re-issued change set schedules `ADD_CHANGE_SET` notifications. See [Correcting and Re-issuing Data](README.md#correcting-and-re-issuing-data) (#4).
- `getChangeLog` returns change sets ordered by change set id, oldest first. Previously the order was whatever Postgres happened to return (#19).
- `getChangeLog` and `getCurrentChangeSet` read `fby_change_set_entity`, one row per change set and entity, instead of every data frame, so their cost grows with the number of change sets rather than the number of frames. A trigger on `fby_data_frame` fills the table, so data frames inserted by your own SQL are included. Deleting every data frame for an entity in a change set with SQL does not remove the change set from the change log of projections that use that entity, so delete the change set instead (#38).
- `fby_data_frame` is indexed on `(entity_id, change_set_id)`, so aggregate functions no longer scan every data frame to find an entity's frames up to a change set (#35).
- Filby no longer creates or uses the pgcrypto extension. `init()` previously failed on a database that already had it, and needed the privilege to create extensions, which managed Postgres services often withhold. Entity tags are now derived from `gen_random_uuid()` and keep their 20 hexadecimal character form. Existing entity tags are unchanged, and the extension stays installed but unused by Filby, so drop it if nothing else needs it (#23).
- A projection dependency or change set frame that names an entity which does not exist fails with `Projection 'VAT Rates v1' references a non existent entity 'VAT Rate v2'` or `Change set '2020 VAT Rates' references a non existent entity 'VAT Rate v2'`, instead of a `NOT NULL` violation on `entity_id` (#26).
- An `ADD_HOOK` with a `projection` and `version` must have the `ADD_CHANGE_SET` event. Previously a projection on an `ADD_PROJECTION` or `DROP_PROJECTION` hook was silently ignored and the hook fired for every projection. `COMMENCE_CHANGE_SET` is also accepted by the schema ahead of #55, but is not yet a database event. `DROP_ENTITY` now requires `operation` like every other operation (#29).
- `fby_hook.name` is declared `UNIQUE` rather than `UNIQUE NULLS NOT DISTINCT`. The clause did nothing on a `NOT NULL` column and was the only PostgreSQL 15 feature Filby used, so Filby now requires PostgreSQL 13 or later. Existing databases are unchanged (#28).

### Fixed

- `getAggregates` quotes the aggregate function name, so an entity whose name contains characters that are not valid in an unquoted identifier can be read through the API as well as through its table (#27).
- `startNotifications` does nothing if Filby is already polling. Previously each call started another poller, and only the last could be stopped, so `stopNotifications` and `stop` left the others running. `stopNotifications` now discards the stopped poller, so `startNotifications` after it starts a fresh one (#21).
- A YAML data frame field with no value (`label:` or `label: ~`) is stored as `NULL`. Previously text columns stored an empty string and other columns failed with a cast error. A nested map or list is stored as JSON, so it can be loaded into a `JSON` or `JSONB` column; a quoted value is still stored as text (#8).
- `unsubscribe(event)` with no handler removes every handler for the event, as documented. Previously it threw `removeListener only takes instances of Function` (#20).

### Added

- Entity definitions are recorded in `fby_entity_field`, `fby_entity_check` and `fby_enum`. Existing entities and enums are backfilled on upgrade (#3).
- `fby_change_set` gains `superseded_by` and `reissued_from`. `getChangeLog` and `getCurrentChangeSet` exclude change sets whose `superseded_by` is set, while `getChangeSet` still returns them. Change sets gain `reissuedFrom`, the id of the change set they re-issue, if any. (#99).
- `getChangeLog` accepts `{ since: changeSetId }` and returns only the change sets with a higher id, so a consumer can resume from the last change set it processed (#56).

### Fixed

- Filby no longer modifies the shared Handlebars module. Its helpers and partials are registered on a private Handlebars environment, and the guard that rejects unescaped expressions is installed only while a Filby migration is rendered. Previously, loading Filby made a host application's own Handlebars templates throw and replaced any helper the host had registered under the same name (#24).
