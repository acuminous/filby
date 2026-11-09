# Changelog

## 1.0.0

### Upgrading from 0.14.0 to 1.0.0

This release contains breaking changes. Filby converts a 0.14.0 database the first time `init()` runs, but some data, SQL and application code may need changing first. Follow [Upgrading from 0.14.0 to 1.0.0](README.md#upgrading-from-0140-to-100) in the README.

### Changed

- Filby requires Node.js 22.12 or later and PostgreSQL 15 or later.
- The `POST` frame action is renamed to `SET`. YAML, JSON and CSV migrations may still say `POST`, but SQL must use `'SET'` (#77).
- A change set may contain only one frame for each key of an entity (#6).
- Adding a change set with an earlier effective date than existing ones re-issues the later change sets with new ids, so ids always follow effective dates. The originals keep their data but leave the change log (#4, #99).
- Change set ids come from a counter instead of a sequence, so a failed migration leaves no gap and every database built from the same migrations gives its change sets the same ids. `fby_change_set.id` no longer has a default, so SQL that inserts a change set must take its id from `fby_next_change_set_id()` (#242).
- Aggregates take each record from the change set with the latest effective date, rather than from the most recently added frame (#3).
- Deleting a change set with SQL also deletes its rows from the entity tables (#6, #25).
- Entity checks apply only to `SET` frames, so they no longer block deletes. SQL that inserts rows into an entity table must supply the new `fby_change_set_id` and `fby_action` columns (#6, #225).
- `getChangeLog` returns change sets in id order, oldest first (#19).
- `getAggregates` rejects when the change set does not exist, instead of returning an empty array (#49).
- `Filby.NOTIFICATION_ERROR` is emitted after every failed delivery attempt. The `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED` payload is now `{ error, notification }`, and the `ErrorNotification` type is removed (#16).
- A notification for a hook with no subscriber counts as a failed attempt and is retried, instead of being discarded (#15).
- An `ADD_HOOK` with a `projection` must use a change set event, and `DROP_ENTITY` requires `operation` (#29).
- Notifications pause on every instance while migrations run (#101).
- Filby no longer uses the pgcrypto extension, so `init()` no longer needs permission to create extensions. The upgrade leaves the extension installed (#23).
- Migration errors quote names as they were written, and explain when two names clash because they only differ in case or spacing (#185).
- Errors about a missing entity or projection suggest the names that do exist (#26, #49).
- A change set row that PostgreSQL rejects is reported with the migration file and the row's location (#157).
- Change set data is loaded in batches, so a 20,000 row CSV loads in seconds rather than about 30 seconds (#37).
- Change logs and aggregates are read through new indexes and tables, so their cost grows with the number of change sets rather than the number of frames (#35, #36, #38).
- An enum field type may be written as the enum was declared, such as `Amenity Category` (#190).
- The example application is a single TypeScript Hono application, with holiday park data, in `examples/holiday-park` (#65, #175, #179, #187, #192, #200, #205, #208, #209, #211, #264).
- The published package contains only `index.js`, `index.d.ts`, `bin`, `lib`, `migrations`, the changelog, the README and the licence. It no longer includes the tests or the repository's tool configuration (#247).

### Added

- Projections declared in YAML, with a `root` entity, `parameters`, `order` and `paging`. Filby generates the projection's SQL function (#63).
- Parameters with `gt`, `gte`, `lt` and `lte` matches (#161), `contains` and `in` matches on array fields (#215), and paths that filter on nested or looked-up records (#216).
- `nest` and `lookup` in projections, to include related records as lists or single objects, to any depth (#104, #163, #177, #191).
- `fields` in projections, to choose which fields a document carries, and `{ field, as }` to rename them (#199, #213).
- `filby.getDocuments`, which returns a projection's documents with their nests and lookups (#104).
- `filby.fetch`, a framework-independent HTTP handler for change logs, projections and the list of projections. Its `ETag` header is the change set's `entityTag` in double quotes (#59, #180, #244).
- A generated OpenAPI document at `/openapi.json`, which says how each parameter matches and which field it filters (#64, #198, #235).
- `filby export`, which writes a projection's documents at every change set to a bundle. [filby-pack](https://github.com/acuminous/filby-pack), released separately, turns a bundle into an npm module (#181).
- `filby migrate`, which applies outstanding migrations and exits, and `init({ migrate: false })`, which starts an instance without applying migrations and rejects if any are outstanding (#236).
- `filby validate` and `filby preview`, which check migrations and show their SQL without a database (#47).
- A published JSON Schema for migration files, for editor validation and completion (#48).
- The `COMMENCE_CHANGE_SET` hook event, which fires when a projection's current change set changes. Adding the hook or a projection schedules notifications for future change sets that were loaded earlier (#55, #241).
- `notifications.listen`, which delivers notifications as soon as they are scheduled rather than at the next poll (#57).
- `notifications.handlerTimeout`, and an `AbortSignal` passed to each handler (#22).
- `filby.getNotificationStatus()`, for health checks (#58).
- `ALTER_ENUM`, which adds values to an existing enum (#62).
- `timezone` on a change set, so `effective` can be a calendar date (#102).
- `nullable: false` on entity fields, and shorter equivalent forms of the DSL (#51).
- `since` on `getChangeLog`, to read only newer change sets (#56).
- Frame actions in any case, and an `action` on a CSV source frame that applies to every row (#103).
- CSV sources with a `.tsv` extension, read as tab-separated (#214).

### Fixed

- Calling `startNotifications` twice no longer starts a second poller that cannot be stopped (#21).
- `withTransaction` runs its callback in a real transaction, so two instances can no longer deliver the same notification (#13).
- A failed poll or a pool error is reported as `Filby.NOTIFICATION_ERROR`, instead of stopping polling or exiting the process (#14, #17).
- A `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED` listener that throws no longer exits the process (#16).
- Delivering a notification for one projection no longer discards the delivery records of other projections on the same hook (#18).
- `unsubscribe(event)` without a handler removes every handler, as documented (#20).
- An invalid or negative `notifications` duration is rejected when Filby is constructed (#134).
- CSV cells are passed to PostgreSQL as written, so `007` keeps its leading zeros in a `TEXT` column. An empty cell is stored as `NULL` (#7).
- Inline YAML and JSON data values are passed to PostgreSQL as written, so `007` keeps its leading zeros in a `TEXT` column, `1.50` keeps its scale in a `NUMERIC` column and large integers keep their precision. Nested maps and lists are still stored as JSON (#240).
- A YAML field with no value is stored as `NULL` rather than an empty string, and a nested map or list is stored as JSON (#8).
- A CSV source with a single column loads (#152).
- Field types such as `NUMERIC(10,2)`, `TEXT[]` and schema-qualified types are accepted (#9).
- `DROP_ENUM` and `ALTER_ENUM` find an enum by the name it was declared with (#145).
- An array of an enum is served as an array of strings (#196), including an enum added by another process after the instance started (#236).
- `getAggregates` works for entities whose names need quoting (#27).
- Filby no longer changes the shared Handlebars module used by the host application (#24).
- `index.d.ts` matches the code (#31).
