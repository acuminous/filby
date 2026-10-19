# Changelog

## Unreleased

### Upgrading

Upgrade and restart. Filby applies its own migrations when `init()` is called, regenerates existing aggregate functions with the new ordering and `LANGUAGE sql STABLE` body, relabels existing `POST` frames as `SET`, re-issues change sets that are out of order, records which entities each existing change set touches in `fby_change_set_entity`, records whether each existing entity field is nullable in `fby_entity_field` (key fields are not, every other field is), records the hook event on each existing notification in `fby_notification`, and replaces the default for `fby_change_set.entity_tag` with one that does not use pgcrypto. No other data is changed.

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
- The errors for references to a non existent entity or projection end with a hint: `; did you mean 'Park v1'?` when an entity or projection with the same name in a different case and the same version exists, otherwise `; existing entities are 'Park v1', 'Season v1'` or `; no entities exist`. `getAggregates` rejects with `Change set 42 does not exist` when the change set does not exist, instead of returning an empty array (#49).
- An `ADD_HOOK` with a `projection` and `version` must have a change set event, `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET`. Previously a projection on an `ADD_PROJECTION` or `DROP_PROJECTION` hook was silently ignored and the hook fired for every projection. `DROP_ENTITY` now requires `operation` like every other operation (#29).
- Change set data frames are inserted in batches of up to 1000 rows per statement. Each batch is rendered as JSON and converted by Postgres using the entity table's row type, instead of three statements per row, so a 20,000 row CSV loads in under a second rather than about 30 seconds. A data frame field or CSV column that the entity does not declare fails with `Change set '2020 VAT Rates' references a non existent field 'wombat' of entity 'VAT Rate v1'` instead of a Postgres `column does not exist` error (#37).
- `fby_hook.name` is declared `UNIQUE` rather than `UNIQUE NULLS NOT DISTINCT`. The clause did nothing on a `NOT NULL` column and was the only PostgreSQL 15 feature Filby used, so Filby now requires PostgreSQL 13 or later. Existing databases are unchanged (#28).

### Fixed

- `getAggregates` quotes the aggregate function name, so an entity whose name contains characters that are not valid in an unquoted identifier can be read through the API as well as through its table (#27).
- Entity field types may contain commas, square brackets and dots, so `NUMERIC(10,2)`, `DECIMAL(5,2)`, `TEXT[]` and schema-qualified types such as `accounts.currency` are accepted. Quotes, semicolons and other characters that could break out of a column definition are still rejected, and the error now names the entity and field (#9).
- `startNotifications` does nothing if Filby is already polling. Previously each call started another poller, and only the last could be stopped, so `stopNotifications` and `stop` left the others running. `stopNotifications` now discards the stopped poller, so `startNotifications` after it starts a fresh one (#21).
- A YAML data frame field with no value (`label:` or `label: ~`) is stored as `NULL`. Previously text columns stored an empty string and other columns failed with a cast error. A nested map or list is stored as JSON, so it can be loaded into a `JSON` or `JSONB` column; a quoted value is still stored as text (#8).
- CSV cells are stored as the text in the file and cast by Postgres to the column type, so `007` keeps its leading zeros in a `TEXT` column and `1.50` keeps its scale in a `NUMERIC` column. Previously cells were converted to JavaScript values first, so `007` became `7`, `1e3` became `1000`, `1.50` became `1.5` and `TRUE` became `true` whatever the column type. An empty CSV cell is stored as `NULL` (#7).
- `unsubscribe(event)` with no handler removes every handler for the event, as documented. Previously it threw `removeListener only takes instances of Function` (#20).
- `withTransaction` runs its callback inside a real transaction, committed when the callback returns and rolled back if it throws, and a client whose transaction failed is discarded rather than returned to the pool. Previously there was no `BEGIN`, so the lock taken when claiming a notification was released before the handler ran and two instances polling the same database could both deliver it. The lock is now held for the whole delivery, so other instances skip the notification and it is delivered once (#13).
- Filby no longer modifies the shared Handlebars module. Its helpers and partials are registered on a private Handlebars environment, and the guard that rejects unescaped expressions is installed only while a Filby migration is rendered. Previously, loading Filby made a host application's own Handlebars templates throw and replaced any helper the host had registered under the same name (#24).
- Passing a notification removes only the previous successful notification for the same hook and projection. Previously it removed every successful notification for the hook, so for a hook that is not restricted to a projection, delivering one projection's notification discarded the record of the last successful delivery for every other projection (#18).
- A failed poll for notifications, such as a database outage, is reported by emitting `Filby.NOTIFICATION_ERROR` with the error, and polling continues at the next interval. Previously the first failed poll stopped polling for good and raised an unhandled rejection, which exits the process under Node's defaults (#14).
- An unparseable `notifications` duration such as `interval: 'soon'` is rejected when Filby is constructed with `Invalid config: /notifications/interval must be a duration such as '30s'`. A negative duration is rejected too. Previously the string passed validation and `parse-duration` turned it into `null` at runtime, so failed hooks were retried with no backoff, handlers were aborted immediately or the poller looped without delay (#134).
- A notification for a hook with no subscriber is treated as a failed attempt, so `last_error` records `No subscribers for hook '...'`, the normal backoff and `HOOK_MAX_ATTEMPTS_EXHAUSTED` apply, and a late subscriber receives it on the next attempt. Previously the notification was marked OK and deleted, so a hook name typo, a case mismatch or calling `startNotifications` before `subscribe` silently lost events (#15).
- An error raised by the connection pool, such as the server closing an idle connection after a restart or failover, is reported by emitting `Filby.NOTIFICATION_ERROR` with the error. Previously the pool had no error listener, so the `error` event was unhandled and exited the process (#17).

### Added

- The DSL gains equivalent forms: entity `fields` as a map (`code: TEXT`, or `price:` with `type` and `nullable`), `key` for `identified_by`, `changes` for `frames`, and `entity: park@1` or `projection: parks@1` for the `entity` or `projection` plus `version` pair. `version` defaults to 1 on `ADD_ENTITY` and `ADD_PROJECTION`, but never on a reference. Every existing spelling remains a first-class equivalent and old migrations run unchanged. See [Equivalent forms](README.md#equivalent-forms) (#51).
- Entity fields can be declared `nullable: false`. `fby_entity_field` gains `nullable`, recorded from the declaration (key fields are never nullable) and backfilled as `false` for key fields and `true` for every other existing field. Nullability is not yet enforced on the entity table, because a `DELETE` frame carries only the key fields (#51).
- Entity definitions are recorded in `fby_entity_field`, `fby_entity_check` and `fby_enum`. Existing entities and enums are backfilled on upgrade (#3).
- `fby_change_set` gains `superseded_by` and `reissued_from`. `getChangeLog` and `getCurrentChangeSet` exclude change sets whose `superseded_by` is set, while `getChangeSet` still returns them. Change sets gain `reissuedFrom`, the id of the change set they re-issue, if any. (#99).
- `getChangeLog` accepts `{ since: changeSetId }` and returns only the change sets with a higher id, so a consumer can resume from the last change set it processed (#56).
- A change set's `effective` may be a calendar date, such as `2026-01-01`, when the change set declares a `timezone` (an IANA name such as `Europe/London`). The date is midnight in that timezone, so daylight saving time is handled by Postgres. A bare date without a `timezone` is rejected, because Filby never uses the process timezone. Timestamps with an explicit offset work as before, with or without a `timezone`. YAML parsing is pinned to the YAML 1.2 core schema, so a bare date is always read as a string (#102).
- A `COMMENCE_CHANGE_SET` hook event, declared like `ADD_CHANGE_SET` with an optional projection, fires when a projection's current change set changes: immediately for a change set whose effective date has already passed, and on the effective date for a pre-released one, so a consumer caching current data hears about next year's rates when they take effect. The notification is scheduled when the change set is added, so it survives restarts, and a re-issued change set schedules one for its inherited effective date. Each pre-released effective date fires once, whereas `ADD_CHANGE_SET` notifications for a projection still coalesce into one. `fby_notification` gains an `event` column, and `fby_notify_add_change_set` now takes the change set id as its first argument, which only affects your own SQL that calls it. See [Notifications](README.md#notifications) (#55).
- Notification handlers receive `{ signal }` as a second argument, an `AbortSignal` that is aborted when the handler exceeds `notifications.handlerTimeout` (default `30s`) or when `stopNotifications` or `stop` is called. A handler that times out is treated as a failed attempt, so the normal backoff and `HOOK_MAX_ATTEMPTS_EXHAUSTED` apply, and `last_error` records the timeout. Previously a hung handler blocked the poller for ever and, since #13, held the notification's row lock. A timed-out handler may still complete later, so handlers must be idempotent. See [filby.subscribe](README.md#filbysubscribetevent-string-handler-notification-t-context-handlercontext--promisevoid-void) (#22).
- Frame actions are matched case-insensitively, in YAML, JSON and CSV, so `set`, `Delete` and `post` are accepted and stored upper case. A source frame may specify an `action`, which applies to every row of its CSV, and the CSV must then have no `action` column. A source frame without an `action` requires the CSV to have an `action` column with every cell filled; an empty cell fails the migration with `Error parsing <file>:<row> - Missing action`. Inline frames still require an `action` (#103).
- `getNotificationStatus()` reports whether Filby is polling, whether the poller is `idle` or `running`, the time of the last successful poll, the number of failed polls since then and the last error, and the number of pending, overdue and exhausted notifications, for health checks. The example applications expose it at `GET /health`. See [filby.getNotificationStatus](README.md#filbygetnotificationstatus-promisenotificationstatus) (#58).
- An `ALTER_ENUM` operation adds values to an existing enum, after its current values and in the order listed, and records them in `fby_enum`. Adding a value the enum already has, or altering an enum that does not exist, fails with a readable error. A change set that uses a new value belongs in a later migration file, because Postgres cannot use a new enum value in the transaction that added it; using it in the same file fails with Postgres's `unsafe use of new value` error. See [Data Definition](README.md#data-definition) (#62).
