# Filby - A framework for temporal reference data

[![NPM version](https://img.shields.io/npm/v/filby.svg?style=flat-square)](https://www.npmjs.com/package/filby)
[![Node.js CI](https://github.com/acuminous/filby/workflows/Node.js%20CI/badge.svg)](https://github.com/acuminous/filby/actions?query=workflow%3A%22Node.js+CI%22)
[![Codecov](https://codecov.io/gh/acuminous/filby/graph/badge.svg)](https://codecov.io/gh/acuminous/filby)

*There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.*
<p align="right">-<a href="https://www.amazon.co.uk/Time-Machine-H-G-Wells/dp/1614271976">The Time Machine - H. G. Wells</a></p>

## Contents

- [TL;DR](#tldr)
- [Why change sets](#why-change-sets)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Guide](#guide)
- [Reference](#reference)
- [Example application](#example-application)

## TL;DR

Filby keeps reference data in PostgreSQL with its whole history, and serves any view of it as it stood at any point in that history.

Think of it as source control for reference data, at runtime. In git, a commit bundles related changes to source code and the commit log gives it a hash. In Filby, a change set bundles related changes to reference data and the change log gives it an id. An application asks for the data at a change set id, much as it would check out a commit, and gets the same answer every time.

**Step 1. Define an entity and a projection**

```yaml
# migrations/0001.define-schema.yaml
- operation: ADD_ENTITY
  name: VAT Rate
  fields:
    Code: TEXT
    Name: TEXT
    Rate: NUMERIC(5,2)
  key:
    - Code

- operation: ADD_PROJECTION
  name: VAT Rates
  root: VAT Rate@1
  order:
    - field: Code
```

**Step 2. Load the data from a CSV file, in force from a date**

```yaml
# migrations/0002.rates-2025.yaml
- operation: ADD_CHANGE_SET
  description: 2025 rates
  effective: 2025-01-01T00:00:00Z
  changes:
    - entity: VAT Rate@1
      action: SET
      source: ./csv/rates-2025.csv
```

```
Code,Name,Rate
Standard,Standard rate,20.00
Reduced,Reduced rate,5.00
```

**Step 3. Serve it over HTTP**, here with [Hono](https://hono.dev/)

```js
const filby = new Filby({ database: { user: 'filby', database: 'filby' } });
await filby.init();
app.all('/api/*', (c) => filby.fetch(c.req.raw, { basePath: '/api' }));
```

**Step 4. Read the change log, pick a change set, and ask for the data at it**

```
GET /api/changelog?projection=VAT%20Rates&version=1
```

```json
[
  { "id": 1, "effective": "2025-01-01T00:00:00.000Z", "description": "2025 rates", "lastModified": "2024-12-02T09:14:51.120Z", "entityTag": "6a8f467b146c4695a674" }
]
```

```
GET /api/projections/VAT%20Rates/v1?changeSetId=1
```

```json
[
  { "code": "Reduced", "name": "Reduced rate", "rate": "5.00" },
  { "code": "Standard", "name": "Standard rate", "rate": "20.00" }
]
```

Ask without a change set id and Filby redirects to the one in force now. Load next year's rates today with next year's effective date and they have an id and an answer from the moment they are loaded, and nothing a client already holds changes.

The [example application](#example-application) runs a holiday park business on it: parks, beaches, amenities, a caravan catalogue, prices and VAT rates, loaded from CSV by ten change sets, with a walkthrough that asks it questions.

## Why change sets

Most systems have reference data: rates, codes, catalogues, calendars, the slow-moving facts that everything else depends on. Because it changes rarely, it gets copied everywhere: into caches, client bundles and other services' databases. Each copy is a chance to be wrong. When it does change, the old values are still needed to explain anything that happened under them. Changes are often known in advance, and the people who own them want them loaded now and live on a date. And the shape of the data itself evolves, which must not break the clients that read it.

The usual answers each solve one part of this. A valid-from column on every row pushes the temporal join into every query, and related rows must be joined at the same instant by hand. A cache with a time-to-live trades consistency for staleness. A document with no history can only say what the data is now.

Filby makes the history the primary thing and gives every point in it a key. A change set is a bundle of changes with an effective date. Its id is a snapshot key: the data at change set N is everything Filby knew when N was added that was in force on N's effective date, and that never changes. Everything else follows from that one property.

- **Consistency.** A request that fixes a change set id at the start reads the same data from every projection it touches, however many services serve them.
- **Caching.** A response keyed by change set id is correct forever, so it can be cached indefinitely, in a CDN, a proxy, a process or a client. The id is the cache buster.
- **History.** Any earlier change set still answers exactly as it did, so a price from 2025 can be explained in 2027.
- **Pre-release.** A change set with a future effective date has an id from the moment it is loaded, so it can be fetched and cached before it takes effect. It takes effect by the clock, with a notification, not by a deploy.
- **Evolution.** Entities and projections are versioned, so a breaking change is version 2 alongside version 1, and each client moves when it is ready.
- **Projections.** Each client gets the view it needs, as nested documents or flat rows, and its change log tells it when something it depends on has changed.

Corrections and backfills do not break the guarantee. Data that should have been in an earlier snapshot is loaded as a new change set and the affected change sets are re-issued under new ids, so anything a client cached by id stays right. See [Correcting and re-issuing data](#correcting-and-re-issuing-data).

## How it works

<pre>
┌─────────────────┐
│                 │
│                 │ announces changes via
│   Projection    │───────────────────────────┐
│                 │                           │
│                 │                           │
└─────────────────┘                           │
         │ depends on                         │
         │                                    │
         │                                    │
         │                                    │
         │                                    │
        ╱│╲                                  ╱│╲
┌─────────────────┐                  ┌─────────────────┐                   ┌─────────────────┐
│                 │                  │                 │                   │                 │
│                 │                  │                 │╲ delivered via    │                 │
│     Entity      │                  │  Notification   │───────────────────│      Hook       │
│                 │                  │                 │╱                  │                 │
│                 │                  │                 │                   │                 │
└─────────────────┘                  └─────────────────┘                   └─────────────────┘
         │ aggregates                        ╲│╱ is raised by
         │                                    │
         │                                    │
         │                                    │
         │                                    │
        ╱│╲                                   │
┌─────────────────┐                  ┌─────────────────┐
│                 │                  │                 │
│                 │╲ is grouped by   │                 │
│   Data Frame    │──────────────────│   Change Set    │
│                 │╱                 │                 │
│                 │                  │                 │
└─────────────────┘                  └─────────────────┘
</pre>

An **entity** is a type of reference data: a park, a VAT rate, a caravan model. It is declared with a name, a version, its fields, the key fields that identify one record, and optionally some checks, which become PostgreSQL check constraints. A field may be of any PostgreSQL type, including an enum declared in the same DSL, so the database enforces the permitted values. An entity is never altered in place; a change to its shape is a new version alongside the old one.

A **data frame** is one record of an entity as it was at one point: a `SET` frame carries the record's values, a `DELETE` frame says the record is gone. Frames are only ever added, so the history of a record is the sequence of its frames.

A **change set** groups data frames, for one entity or many, under one effective date, which is the date from which its frames are in force. The effective date is not a date in the data: a park season's start is a fact about the park, whereas the effective date of the change set that carries it is when the park started saying so. A change set is added in one transaction, so it is either wholly visible or not there at all, and its id is the snapshot key.

An **aggregate** is the state of an entity at a change set: one row per key, built from the frames, with deleted records omitted. Filby creates an aggregate function for every entity version, and everything else reads through it.

A **projection** is a versioned view over one or more entities, and the unit a client consumes. Most are declared by naming a root entity, with optional parameters, ordering and paging; related entities are nested under the root as lists, embedded as single objects, and the fields each level carries can be chosen. A projection the DSL cannot express is a SQL function you write over the aggregates. Either way Filby knows which entities the projection depends on, so it knows which change sets affect it, which is what its change log lists.

A **hook** names an event your application wants to hear about: a projection added or dropped, a change set added, or a change set taking effect for a projection. A **notification** is raised for a hook whenever its event happens, and delivered to the handler your application registered, with retries, so downstream copies of the data stay current without polling.

### The snapshot guarantee

> The data at change set N is everything Filby knew when N was added that was in force on N's effective date, and it never changes.

For each key, the aggregate takes the latest frame by effective date and then by change set id, from the change sets with an id no greater than N and an effective date no later than N's. Ids come from a sequence, so anything added later has a higher id and falls outside the snapshot whatever its effective date. Frames and rows are only ever inserted. When something would need to appear under an earlier id, such as backfilled or corrected data, Filby re-issues the affected change sets under new ids and leaves the originals as they were, so a superseded id still returns its original result. The one exception is deleting a change set, the escape hatch for data that was never served, which changes every later snapshot.

This is what makes a change set id safe to build on: consistent reads across a workflow, responses cached without expiry, and future data with a fixed id and fixed contents from the moment it is loaded.

## Getting started

Filby needs Node.js 22.12 or later and PostgreSQL 15 or later, and is tested against PostgreSQL 16.

```bash
npm install filby
```

Construct Filby with the connection details, which are passed through to [node-pg](https://node-postgres.com/), and call `init()` once at startup. `init()` connects, applies Filby's own migrations and then yours, and holds an advisory lock while it does so.

```js
const { Filby } = require('filby');

const filby = new Filby({
  database: { user: 'filby', database: 'filby', password: 'filby' },
  migrations: ['migrations'],
});

await filby.init();
```

Your migrations live in the directories named by `migrations`, which defaults to `migrations` under the working directory. A migration is a YAML, JSON or SQL file named `<level>.<description>.<extension>`, such as `0001.define-schema.yaml`, and the files are applied once each, in level order, by [marv](https://www.npmjs.com/package/marv). Start with a file that declares entities and projections, as in the [TL;DR](#tldr), and add a file per change set after it. The JSON schema for YAML and JSON migrations is published at https://acuminous.github.io/filby/lib/schema.json; begin each file with the `# yaml-language-server` comment shown in the examples below and any editor with YAML language server support, such as VS Code with the YAML extension, validates and completes the file as you type. `npx filby validate migrations` checks the files without a database; see [Command line](#command-line).

Once `init()` has resolved, mount `filby.fetch` to serve the data over HTTP, or call `getDocuments` and the other methods under [API](#api) directly. Call `filby.startNotifications()` after subscribing to hooks, and `filby.stop()` on shutdown.

To run the example application, clone the repository and start the two Postgres containers it uses:

```bash
git clone git@github.com:acuminous/filby.git
cd filby
npm i
npm run docker
cd examples/typescript
npm i
npm start
```

```
Server is listening on port 3000
See http://localhost:3000/documentation
Use CTRL+C or kill -TERM 18964 to stop
```

The [Example application](#example-application) section walks through what it serves.

## Guide

### Entities and enums

An entity is declared with `ADD_ENTITY`: a name, its fields, the key fields that identify one record, and optionally a version, a description and some checks. An enum is declared with `ADD_ENUM` and used as a field type by its declared name.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0001.define-schema.yaml
- operation: ADD_ENUM
  name: Customer Type
  values:
    - Guest
    - Owner

- operation: ADD_ENTITY
  name: Park
  fields:
    Code: TEXT
    Name:
      type: TEXT
      nullable: false
    Region: TEXT
  key:
    - Code
  checks:
    park_code_len: (LENGTH(code) = 2)

- operation: ADD_ENTITY
  name: Park Season
  fields:
    Park Code: TEXT
    Customer Type: Customer Type
    Current Season Start:
      type: DATE
      nullable: false
    Current Season End:
      type: DATE
      nullable: false
    Next Season Start: DATE
    Next Season End: DATE
  key:
    - Park Code
    - Customer Type
```

Adding an entity records it in `fby_entity`, its fields in `fby_entity_field` and its checks in `fby_entity_check`, creates a table `park_v1` to hold its data frames, and creates the aggregate function `get_park_v1_aggregate(p_change_set_id)` that projections read through. `version` defaults to 1. An entity is never altered in place; see [Evolving the schema](#evolving-the-schema).

A field may be of any PostgreSQL type, written as it would be in `CREATE TABLE`, so `NUMERIC(5,2)`, `TIMESTAMP WITH TIME ZONE` and `TEXT[]` all work. An enum declared with `ADD_ENUM` is named by its declared name, as `Customer Type` above, and an array of one as `Beach Surface[]`. A type that is not made of letters, digits, spaces, underscores, brackets, commas and dots fails rendering with `Invalid PostgreSQL TYPE 'x' for field 'Rate' of entity 'VAT Rate v1'`.

Names may be written in Title Case with spaces. Filby canonicalises entity, field, enum, parameter and nest names to lower case with spaces replaced by underscores, so `Park Season` is the table `park_season_v1` and its `Park Code` field is the column `park_code`, in the database and in the documents Filby serves. Projection and hook names and enum values are kept as written. The rules are under [Names](#names).

A key field is `NOT NULL` on the entity table. Every other field is nullable unless declared `nullable: false`, which is recorded in `fby_entity_field` for tooling such as the OpenAPI document to read but is not enforced on the table, because a `DELETE` frame carries only the key fields. Each check becomes a check constraint named `chk_<name>` on the table; the expression is used as written after `CHECK`, so keep the parentheses and use the canonical column names.

An enum creates a PostgreSQL type with the values in the order listed and records them in `fby_enum`, so the database rejects any other value. Values are added later with `ALTER_ENUM`; see [Evolving the schema](#evolving-the-schema).

### Loading data

A change set is added with `ADD_CHANGE_SET`: a description, an effective date and a list of changes, each naming an entity version, an action and the data. A `SET` frame records the values of a record from the effective date, and a `DELETE` frame records that the record is gone, so it needs only the key.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0002.parks.yaml
- operation: ADD_CHANGE_SET
  description: Parks
  effective: 2024-10-01
  timezone: Europe/London
  changes:
    - entity: Park@1
      action: SET
      data:
        - Code: DC
          Name: Devon Cliffs
          Region: South West
        - Code: PV
          Name: Primrose Valley
          Region: Yorkshire
    - entity: Park@1
      action: DELETE
      data:
        - Code: HF
```

YAML gets long, so a frame may take its rows from a CSV file instead, with `source`, a path relative to the migration file. The CSV needs a header row of the entity's field names. Put the action on the frame to apply it to every row, in which case the file must not have an `action` column, or leave it off the frame and give the file an `action` column with every cell filled.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0003.catalogue-2025.yaml
- operation: ADD_CHANGE_SET
  description: 2025 catalogue and price list
  effective: 2025-01-01T00:00:00Z
  changes:
    - entity: Price@1
      action: SET
      source: ./csv/catalogue-2025/price.csv
    - entity: Park@1
      source: ./csv/catalogue-2025/park.csv
```

```
Model Code,Year,List Price
RIO,2025,24995.00
AVO,2025,29995.00
```

```
action,Code,Name,Region
SET,KP,Kiln Park,Wales
set,RP,Rockley Park,South West
DELETE,TP,,
```

The action is read in any case, on the frame or in the file, and `POST` means `SET`. An action in both places, in neither, or missing from a cell fails rendering with a message naming the frame and the file; see [ADD_CHANGE_SET](#add_change_set).

The effective date may be a calendar date, such as `2024-10-01`, or a timestamp with an explicit offset, such as `2024-10-01T00:00:00Z`. A calendar date is midnight in the change set's `timezone`, an IANA name, so the stored instant follows daylight saving time. A calendar date without a `timezone` is rejected, because Filby never uses the process time zone: the same file would otherwise render differently on different machines. A timestamp with an offset is stored as written, with or without a `timezone`. The effective date may be in the future, which is how data is released ahead of time; see [Why change sets](#why-change-sets).

Field names in data and CSV headers are canonicalised like everything else, so `Model Code` and `model_code` both reach the `model_code` column. A field or column the entity does not declare fails with `Change set '2025 catalogue and price list' references a non existent field 'wombat' of entity 'Price v1'`. A field with no value, and an empty CSV cell, is stored as `NULL`. A nested map or list in YAML is stored as JSON, so it can be loaded into a `JSON` or `JSONB` column. CSV cells are read as text and cast by Postgres to the column type, so `007` keeps its leading zeros in a `TEXT` column and `1.50` keeps its scale in a `NUMERIC` column. A value Postgres rejects, for any reason from a bad cast to a check violation, fails the migration with the file, the row and Postgres's message, such as `0003.catalogue-2025.yaml: ./csv/catalogue-2025/price.csv:3 - invalid input syntax for type numeric: "abc"`, and nothing from the migration is applied. A change set may hold one frame per key for each entity; a second fails with `Entity 'Park v1' has more than one frame with key (code=DC) in change set 'Parks'`.

Each change set is added in one transaction, and adding it schedules notifications and may re-issue later change sets; see [Correcting and re-issuing data](#correcting-and-re-issuing-data).

### Projections

Most projections are declared with `ADD_PROJECTION` and a `root` entity. Filby generates a function, `get_parks_v1` here, that returns one row per root record at a change set, filtered by the parameters, in the declared order, one page at a time.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0004.define-projections.yaml
- operation: ADD_PROJECTION
  name: Parks
  description: Parks with their seasons
  root: Park@1
  parameters:
    code:
      field: Code
    name:
      field: Name
      match: prefix
    region:
      field: Region
      match: in
  order:
    - field: Name
      direction: DESC
      nulls: LAST
  paging:
    page_size: 10
    page_max: 50
  nest:
    Seasons:
      entity: Park Season@1
      on:
        Park Code: Code
      order:
        - field: Customer Type
```

Each parameter becomes a nullable argument of the generated function, `p_code`, `p_name` and `p_region` here, of the field's type, and filters the rows when supplied. `match` defaults to `equals`. `prefix` matches the start of the field literally. `in` takes an array. `range` takes two arguments, `p_<name>_from` and `p_<name>_to`, each optional and inclusive. `gt`, `gte`, `lt` and `lte` compare the field with `p_<name>`, and two parameters may name the same field, so `gt` and `lte` together make a half-open interval. Parameters combine with AND. The canonical names `change_set_id`, `page_offset` and `page_size` are reserved and fail with `Projection 'Parks v1' parameter 'page_size' uses a reserved name`.

`order` lists root fields to sort by, with `direction` `ASC` or `DESC`, the default `ASC`, and `nulls` `FIRST` or `LAST`, otherwise Postgres decides. The entity key is always appended, ascending, as a tie break, and is the whole order when none is declared.

`paging` adds `p_page_offset`, default 0, and `p_page_size`, default `page_size` and never more than `page_max`, to the function, and an `fby_total` column holding the number of rows that matched the parameters whatever the page. The function above is `get_parks_v1(p_change_set_id, p_code, p_name, p_region, p_page_offset, p_page_size)`.

`nest` embeds the records of a related entity under each root record as a list. Each entry names the child entity and an `on` map from the child's field to the parent's field, and may order the children, with the child's key appended as a tie break. The generated function is unchanged; `filby.getDocuments` and `filby.fetch` run one query per nest and attach the children, so the documents above each carry a `seasons` list, empty when a park has none, and a page is ten parks with all their seasons. A nest may nest its own children in the same way, to any depth, each level joining to its parent.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0005.define-catalogue.yaml
- operation: ADD_PROJECTION
  name: Catalogue
  root: Manufacturer@1
  nest:
    Models:
      entity: Model@1
      on:
        Manufacturer Code: Code
      order:
        - field: Name
      nest:
        Prices:
          entity: Price@1
          on:
            Model Code: Code
          order:
            - field: Year
```

`lookup` embeds a many-to-one entity as a single object rather than a list, at the root or under any nest, and is declared like a nest with one rule: the join must cover the whole key of the looked-up entity, so a parent finds at most one record, and gets `null` when there is none at the change set. A lookup that joins on less fails with `Projection 'Parks (Detailed) v1' lookup 'Amenities.Amenity' does not join on the whole key of entity 'Amenity v1'; missing key fields are 'code'`. A lookup has no order and no nests or lookups of its own; nest the entity instead if it needs children.

`fields` chooses which of an entity's fields a document carries, in that order, at the root, in a nest or in a lookup. Without `fields` a root document carries every field of its entity and a nested one every field except its join fields. With `fields` it carries exactly those, and a join field only if listed. A nest's list may be empty, for a link row whose only content is its lookups; the root's and a lookup's must name at least one field. Parameters and order may still use a field that is not carried. Here each park amenity is a link row carrying only the amenity it points to, with the fields the consumer needs.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0006.define-parks-detailed.yaml
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  root: Park@1
  fields:
    - Code
    - Name
  nest:
    Amenities:
      entity: Park Amenity@1
      on:
        Park Code: Code
      fields: []
      order:
        - field: Amenity Code
      lookup:
        Amenity:
          entity: Amenity@1
          on:
            Code: Amenity Code
          fields:
            - Code
            - Name
            - Charge
```

A nest or lookup name may not repeat a field of its parent entity, may not be `fby_total`, and may not be used twice at one level; the messages are under [ADD_PROJECTION](#add_projection). The root, nested and looked-up entities are all dependencies of the projection, so a change set for any of them appears in the projection's change log and notifies its hooks.

When a projection needs a shape the DSL cannot express, declare its `dependencies` instead of a root and write the function yourself in a SQL migration, named `get_<projection>_v<version>` and taking the change set id. Filby still knows which change sets affect it, and `filby.fetch` serves it by calling the function. The one below joins three aggregates at the same change set, so a price and the VAT rate that applies to it always come from one snapshot.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0007.define-price-list.yaml
- operation: ADD_PROJECTION
  name: Price List
  dependencies:
    - entity: Model@1
    - entity: Price@1
    - entity: VAT Rate@1
```

```sql
-- migrations/0008.create-get-price-list-v1-function.sql
CREATE FUNCTION get_price_list_v1(p_change_set_id INTEGER)
RETURNS TABLE (code TEXT, name TEXT, year INTEGER, list_price NUMERIC(10,2), vat_code vat_code, vat_rate NUMERIC(5,2))
AS $$
  SELECT m.code, m.name, p.year, p.list_price, m.vat_code, r.rate AS vat_rate
  FROM get_model_v1_aggregate(p_change_set_id) m
  INNER JOIN get_price_v1_aggregate(p_change_set_id) p ON p.model_code = m.code
  INNER JOIN get_vat_rate_v1_aggregate(p_change_set_id) r ON r.code = m.vat_code
  ORDER BY m.manufacturer_code, m.name, p.year
$$ LANGUAGE sql STABLE;
```

`parameters`, `order`, `paging`, `fields`, `nest` and `lookup` need a root; using one with `dependencies` fails with `Projection 'Price List' must specify 'root' to use 'parameters'`.

### Hooks and notifications

A hook pairs a name with one of four events. `ADD_PROJECTION` and `DROP_PROJECTION` fire when a projection is added or dropped. `ADD_CHANGE_SET` fires when a change set that touches a projection's entities is added, whatever its effective date. `COMMENCE_CHANGE_SET` fires when a projection's current change set changes, which is whenever `getCurrentChangeSet` would start returning something different: at once for a change set whose effective date has passed, and on the effective date for one loaded ahead of time. A projection's current change set is the one with the latest effective date that is not in the future, so earlier change sets lapse silently. An `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET` hook may name the one projection it is interested in or fire for every projection; `ADD_PROJECTION` and `DROP_PROJECTION` hooks are always general. A mirror such as a data lake subscribes to `ADD_PROJECTION` to learn about new data sets, `ADD_CHANGE_SET` to refresh them and `DROP_PROJECTION` to retire them, whereas a consumer that caches current data subscribes to `COMMENCE_CHANGE_SET` so it hears about next year's rates when they take effect rather than when they are loaded.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0009.define-hooks.yaml
- operation: ADD_HOOK
  name: sns/commence-change-set/parks-v1
  event: COMMENCE_CHANGE_SET
  projection: Parks@1

- operation: ADD_HOOK
  name: data-lake/add-change-set/*
  event: ADD_CHANGE_SET
```

A notification is raised for a hook and a projection whenever the hook's event happens for that projection, and delivered by calling the handler your application registered for the hook's name with `filby.subscribe`. The notification says which hook fired and which projection changed; call `getChangeLog` or `getCurrentChangeSet` for the detail. Handlers are asynchronous, which Filby gets from [eventemitter2](https://www.npmjs.com/package/eventemitter2) rather than Node's EventEmitter. Subscribe before calling `startNotifications`, and give each handler its own hook, because when one of two handlers on a hook fails the retry re-notifies both.

```js
filby.subscribe('sns/commence-change-set/parks-v1', async (notification, { signal }) => {
  await fetch('https://httpbin.org/status/200', { method: 'POST', body: JSON.stringify(notification), signal });
});

await filby.startNotifications();
```

Filby polls the database for due notifications on `notifications.interval`, after `notifications.initialDelay`, and claims each one in a transaction that holds a row lock for the duration of the handler, so several instances may poll at once and each notification is delivered by one of them. The second handler argument carries an [AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal), aborted when the handler exceeds `notifications.handlerTimeout` or when `filby.stopNotifications()` or `filby.stop()` is called. Pass it to anything that accepts one and check `signal.aborted` between steps of a longer handler. A handler that times out is treated as having failed. A promise cannot be cancelled, so a handler that ignores the signal may still complete after the failure has been recorded, and handlers must be idempotent in any case, because at-least-once delivery means a handler can complete just before its process is killed.

A handler that throws, or times out, fails the attempt, and the notification is retried with a delay that doubles from two seconds up to `notifications.maxRescheduleDelay`, until `notifications.maxAttempts` is reached. A hook with no subscriber fails the same way, with `No subscribers for hook 'sns/commence-change-set/parks-v1'`, so check that the event name matches the hook name exactly. Every failed attempt emits `Filby.NOTIFICATION_ERROR` with the error and the notification once the failure is recorded, and the last one also emits `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED` with the same payload. Both are emitted synchronously and an error thrown by a listener is discarded, so catch errors inside the listener. The error may carry secrets from the handler, so take care what you log.

```js
filby.subscribe(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, ({ error, notification }) => {
  console.error('Hook failed', notification, error.stack);
});
```

A poll that fails, for example because the database is briefly unavailable, emits `Filby.NOTIFICATION_ERROR` with the error and no notification, and the next poll happens at the next interval. Errors raised by the connection pool, such as the server closing an idle connection, are reported through the same event.

```js
filby.subscribe(Filby.NOTIFICATION_ERROR, ({ error }) => {
  console.error('Notification polling failed', error.stack);
});
```

`filby.getNotificationStatus()` reports whether polling has started, the last successful poll and the failures since it, and how many notifications are pending, overdue and exhausted, for a health check; the fields are under [API](#api). A growing `overdue` count while polls succeed means handlers are failing. The method rejects when the database is unavailable, which is what a health check should do.

```js
app.get('/health', async (c) => {
  const status = await filby.getNotificationStatus();
  return c.json(status, status.started && status.failuresSinceLastSuccess === 0 ? 200 : 503);
});
```

Notifications pause while migrations run. `filby.init()` holds an exclusive advisory lock for the duration of the migrations and each poll takes the same lock in shared mode, so no delivery starts on any instance until the migrations have finished, and a migration waits for deliveries already in flight, up to the handler timeout, so keep `handlerTimeout` short.

With `notifications.listen` set, Filby also holds a dedicated connection that listens for the `NOTIFY` sent whenever a notification is scheduled, and polls at once, so `ADD_CHANGE_SET`, `ADD_PROJECTION` and `DROP_PROJECTION` are delivered without waiting for the next interval. Polling remains the safety net, because a `NOTIFY` sent while that connection is down is lost, and `COMMENCE_CHANGE_SET` is always delivered by the poll, since a change set reaching its effective date is not a database write. A dropped listening connection is reported through `Filby.NOTIFICATION_ERROR` and reconnected with a delay that doubles from one second up to a minute.

### Correcting and re-issuing data

The aggregates for a change set include the frames from every change set with a lower or equal id and an earlier or equal effective date. This only works while change set ids follow effective dates, which pre-releasing or backfilling data would break. Filby keeps them in order by re-issuing change sets.

When you add a change set, Filby re-issues every live change set with a later effective date. A re-issued change set has a new id, the same description, effective date and data frames as the original, and `reissuedFrom` set to the original's id. The original is superseded: `getChangeLog` and `getCurrentChangeSet` no longer return it, but `getChangeSet` and `getAggregates` still do, with their original results, so anything cached by its id stays correct. A re-issued change set schedules `ADD_CHANGE_SET` and `COMMENCE_CHANGE_SET` notifications like any other.

So adding one change set can add more than one entry to the change log. Given change set 1 effective 2026-01-01 and a pre-released change set 2 effective 2027-01-01, adding change set 3 effective 2026-06-01 re-issues change set 2 as change set 4. The change log becomes 1, 3, 4, and the aggregates for change set 4 include the data from change set 3.

Adding a change set with the same effective date as an existing one re-issues nothing. The new change set wins because it has the higher id, which is how data is corrected: add a change set with the same effective date and the corrected frames. The correction overrides the original from that date onwards, clients following the current change set see it at once, and the original snapshot is unchanged for anyone who cached it. Any pre-released change set with a later effective date is re-issued as usual.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0010.correct-parks.yaml
- operation: ADD_CHANGE_SET
  description: Parks (corrected)
  effective: 2024-10-01
  timezone: Europe/London
  changes:
    - entity: Park@1
      action: SET
      data:
        - Code: PV
          Name: Primrose Valley Holiday Park
          Region: Yorkshire
```

The DSL has no operation for dropping change sets or data frames, because they are meant to be immutable. Deleting a change set is the escape hatch for one that was never served, and is done in a SQL migration. The aggregates of every later change set change, so anything cached by id is wrong afterwards. The delete cascades to the change set's data frames and to their rows in the entity tables, so delete the change set rather than its frames. If you delete every data frame for an entity in a change set, the change set still appears in the change log of projections that use that entity, with correct but redundant aggregates.

```sql
-- migrations/0011.delete-a-change-set.sql
START TRANSACTION;

DELETE FROM fby_change_set
 WHERE id = 4;

END TRANSACTION;
```

A superseded change set and its re-issue reference each other, so neither can be deleted on its own. Delete them in the same statement.

```sql
DELETE FROM fby_change_set
 WHERE id IN (2, 4);
```

### Evolving the schema

A change to the shape of an entity is a new version alongside the old one, and a projection over it is a new version too, so each client moves when it is ready. A reference to an entity or a projection always names the version, as `Park@2`, and `version` defaults to 1 only on `ADD_ENTITY` and `ADD_PROJECTION`, because a defaulted reference would silently write to the wrong version once version 2 exists.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0012.park-v2.yaml
- operation: ADD_ENTITY
  name: Park
  version: 2
  fields:
    Code: TEXT
    Name:
      type: TEXT
      nullable: false
    Region: TEXT
    Postcode: TEXT
  key:
    - Code

- operation: ADD_PROJECTION
  name: Parks
  version: 2
  root: Park@2
  order:
    - field: Name
```

An enum grows with `ALTER_ENUM`, which adds the values after the existing ones in the order listed. A change set that uses a new value belongs in a later migration file, because Postgres cannot use a new enum value in the transaction that added it, and using it in the same file fails with Postgres's `unsafe use of new value` error. Adding a value the enum already has fails with `Enum 'customer_type' already has value 'Staff'`.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0013.customer-type-staff.yaml
- operation: ALTER_ENUM
  name: Customer Type
  add:
    - Staff
```

What is no longer needed is dropped. `DROP_HOOK` deletes the hook and its notifications. `DROP_PROJECTION` deletes the projection, the hooks that name it and its notifications, drops its generated function, and schedules `DROP_PROJECTION` notifications. `DROP_ENTITY` deletes the entity's metadata, its table and its aggregate function, and is blocked by Postgres while a projection depends on the entity or a change set holds frames for it. `DROP_ENUM` drops the type and its values, and is blocked by Postgres while a column uses it. Each fails with `... does not exist` when there is nothing to drop.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0014.drop-unused-objects.yaml
- operation: DROP_HOOK
  name: sns/commence-change-set/parks-v1

- operation: DROP_PROJECTION
  name: Parks
  version: 1

- operation: DROP_ENTITY
  name: Park
  version: 1

- operation: DROP_ENUM
  name: Customer Type
```

Some parts of the DSL can be written in more than one way, so migrations written for earlier versions of Filby keep working unchanged; see [Equivalent forms](#equivalent-forms).

### Serving over HTTP

`filby.fetch(request, options)` serves the projection list, the change logs, the projections and an OpenAPI document using the web standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) and [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response), so it has no framework dependency. Routes are relative to `options.basePath`, which defaults to `''`. `GET /projections` lists the projections as `{ name, version, description }` in name and version order, `GET /changelog?projection=<name>&version=<n>[&since=<id>]` returns a projection's change log as `getChangeLog` does, `GET /projections/<name>/v<n>?changeSetId=<id>` returns the documents at a change set as a JSON array, and `GET /openapi.json` describes them all. The projection name is URL-encoded, so `/projections/VAT%20Rates/v1`. A declared parameter is passed by name, an `in` parameter is repeated, as `?region=Scotland&region=Wales`, and a `range` parameter takes `<name>_from` and `<name>_to`. `page` is 1-based and `pageSize` defaults to the declared `page_size` and is clamped to `page_max`. A request without `changeSetId` is redirected with a 307 to the current change set, keeping every other query parameter, so a client that asks for `/projections/Parks/v1?code=DC` lands on `/projections/Parks/v1?code=DC&changeSetId=8` and can cache what comes back.

A projection response can be cached for ever: it carries `Cache-Control: max-age=31536000, immutable`, `ETag` and `Last-Modified` from the change set, `X-Total-Count` with the number of documents that matched, and `Link` headers to the next and previous pages. A change log carries `ETag` and `Last-Modified` from its latest entry. The projection list and the OpenAPI document change when a projection is added or dropped, so they are served without cache headers. Every error is JSON `{ "error": "..." }`; the status codes and headers are under [HTTP](#http). Errors the handler does not expect, such as a lost database connection, are thrown for the host application to log and turn into a 500.

[Hono](https://hono.dev/) mounts the handler in one line:

```js
app.all('/api/*', (c) => filby.fetch(c.req.raw, { basePath: '/api' }));
```

Express needs a short adapter:

```js
app.use('/api', async (req, res, next) => {
  try {
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, { method: req.method });
    const response = await filby.fetch(request, { basePath: '/api' });
    res.status(response.status);
    response.headers.forEach((value, name) => res.set(name, value));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    next(err);
  }
});
```

`GET /openapi.json` is generated from Filby's metadata tables, so a new projection is documented, its clients generated and its requests validated without anyone writing a schema. Each root projection has a path with its declared parameters, its paging parameters and a response schema built from the entity fields, the nests and the lookups. Pass `options.info` to set the document's title, version and description; the example application serves Swagger UI from it. The contents are under [OpenAPI document](#openapi-document).

### Caching in process

The aggregate functions and generated projection functions are declared `STABLE`, and a function you write over them should be too, since its results depend on the change sets in the database. Do any caching in the application: the data at a change set never changes, so a cache keyed by projection, version and change set id needs no invalidation, but every new change set is a new key, so bound it with an LRU or TTL cache rather than an unbounded map. This is the in-process complement to the change set id as an HTTP cache buster.

```js
const cache = new LRUCache({ max: 500 });

async function getParks(changeSetId, parameters) {
  const key = JSON.stringify(['Parks', 1, changeSetId, parameters]);
  if (!cache.has(key)) cache.set(key, await filby.getDocuments(projection, changeSetId, { parameters }));
  return cache.get(key);
}
```

## Reference

### DSL

A migration is a YAML or JSON list of operations, each with an `operation` and the keys below. The list must have at least one entry, and unknown keys fail validation with `<file>: /0 must NOT have additional property 'wombat'`. Validation failures name the file and the JSON path of the offending value. Installation failures are raised by Postgres when the migration runs, and nothing from the migration is applied.

#### ADD_ENUM

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | Canonicalised for the type name and `fby_enum` |
| `values` | list of strings, at least one | yes | Kept as written, in order |
| `description` | string | no | Accepted but not stored |

Fails at install with `Enum 'customer_type' already exists`.

#### ALTER_ENUM

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `add` | list of strings, at least one | yes | Appended after the existing values, in order |
| `description` | string | no | Accepted but not stored |

Fails at install with `Enum 'customer_type' does not exist` or `Enum 'customer_type' already has value 'Staff'`. A change set in the same file that uses an added value fails with Postgres's `unsafe use of new value` error.

#### DROP_ENUM

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `description` | string | no | Accepted but not stored |

Fails at install with `Enum 'customer_type' does not exist`, or with Postgres's dependency error while a column uses the type.

#### ADD_ENTITY

| Key | Type | Required | Default | Notes |
| --- | ---- | -------- | ------- | ----- |
| `name` | string | yes | | |
| `version` | integer | no | 1 | |
| `description` | string | no | | Stored in `fby_entity` |
| `fields` | map of name to type, or to `{ type, nullable }`; or list of `{ name, type, nullable }`; at least one | yes | | `nullable` defaults to `true`; key fields are never nullable |
| `key` | list of field names, at least one | one of `key`, `identified_by` | | |
| `identified_by` | list of field names, at least one | one of `key`, `identified_by` | | Equivalent to `key` |
| `checks` | map of name to expression, at least one | no | | Each becomes `CONSTRAINT chk_<name> CHECK <expression>` |

Fails at validation with `Identifier 'wombat' does not match one of the 'Park' entity field names`, `Entity 'Park' must specify either 'key' or 'identified_by', not both` or `Invalid PostgreSQL TYPE 'x' for field 'Rate' of entity 'VAT Rate v1'`, and at install with `Entity 'Park v1' already exists`.

#### DROP_ENTITY

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `version` | integer | yes | |
| `description` | string | no | Accepted but not stored |

Drops the metadata, the table and the aggregate function. Fails at install with `Entity 'Park v1' does not exist`, or with Postgres's foreign key error while a projection depends on the entity or a change set holds frames for it.

#### ADD_PROJECTION

| Key | Type | Required | Default | Notes |
| --- | ---- | -------- | ------- | ----- |
| `name` | string | yes | | Kept as written |
| `version` | integer | no | 1 | |
| `description` | string | no | | Served by `GET /projections` and the OpenAPI document |
| `root` | `Entity@n` | one of `root`, `dependencies` | | Must name the version with `@n` |
| `dependencies` | list of `{ entity, version }`, at least one | one of `root`, `dependencies` | | For a projection whose function you write |
| `fields` | list of field names, at least one | no | every field | Root only |
| `parameters` | map of name to `{ field, match }`, at least one | no | | Root only; `match` defaults to `equals` |
| `order` | list of `{ field, direction, nulls }`, at least one | no | the key | Root only; `direction` `ASC` or `DESC`, default `ASC`; `nulls` `FIRST` or `LAST` |
| `paging` | `{ page_size, page_max }`, both integers of at least 1 | no | | Root only; both required |
| `nest` | map of name to nest | no | | Root only |
| `lookup` | map of name to lookup | no | | Root only |

A parameter's `match` is one of `equals`, `prefix`, `in`, `range`, `gt`, `gte`, `lt` and `lte`, and its `field` must be a field of the root. The canonical parameter names `change_set_id`, `page_offset` and `page_size` are reserved.

A nest has these keys. A lookup has `entity`, `on` and `fields` only, and its `fields` must name at least one field.

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `entity` | `Entity@n` | yes | Must name the version with `@n` |
| `on` | map of child field to parent field, at least one | yes | A lookup's `on` must cover the whole key of its entity |
| `fields` | list of field names | no | May be empty on a nest |
| `order` | list of `{ field, direction, nulls }`, at least one | no | The child's key is appended |
| `nest` | map of name to nest | no | To any depth |
| `lookup` | map of name to lookup | no | |

Fails at validation with `Projection 'Parks' must specify either 'root' or 'dependencies', not both`, `Projection 'Price List' must specify 'root' to use 'parameters'` or `Reference 'Park@1' must not also specify a version`. Fails at install with `Projection 'Parks v1' already exists`; `Projection 'Parks v1' references a non existent entity 'Park v1'; existing entities are 'Amenity v1', 'Park Season v1'`, or `; did you mean 'Park v1'?` when only the case differs, or `; no entities exist`; `Projection 'Parks v1' parameter 'code' references a non existent field 'wombat' of entity 'Park v1'; existing fields are 'code', 'name'`, and likewise for `orders by` and `selects`; `Projection 'Parks v1' parameter 'page_size' uses a reserved name`; `Projection 'Parks v1' nest 'seasons' joins on a non existent field 'wombat' of entity 'Park Season v1'; existing fields are ...`, and likewise for a nest's `orders by` and `selects`; `Projection 'Parks v1' nest 'Name' has the same name as a field of entity 'Park v1'`; `Projection 'Parks v1' nest 'fby_total' uses a reserved name`; `Projection 'Parks v1' declares 'seasons' more than once`; and `Projection 'Parks (Detailed) v1' lookup 'Amenities.Amenity' does not join on the whole key of entity 'Amenity v1'; missing key fields are 'code'`. A nest below the root is named by its path, as `nest 'Seasons.Rates'`.

#### DROP_PROJECTION

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `version` | integer | yes | |
| `description` | string | no | Accepted but not stored |

Deletes the projection, the hooks that name it, its notifications and its generated function, and schedules `DROP_PROJECTION` notifications. Fails at install with `Projection 'Parks v1' does not exist`.

#### ADD_HOOK

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | Unique; kept as written; the name to `subscribe` to |
| `event` | `ADD_PROJECTION`, `DROP_PROJECTION`, `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET` | yes | |
| `projection` | `Projection@n`, or a name with `version` | no | Only with `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET`; otherwise the hook is general |
| `version` | integer | with a `projection` that has no `@n` | |
| `description` | string | no | Stored in `fby_hook` |

Fails at install with `Hook 'sns/add-change-set/parks-v1' already exists` or `Hook 'sns/add-change-set/parks-v1' references a non existent projection 'Parks v1'; existing projections are ...`.

#### DROP_HOOK

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `description` | string | no | Accepted but not stored |

Deletes the hook and its notifications. Fails at install with `Hook 'sns/add-change-set/parks-v1' does not exist`.

#### ADD_CHANGE_SET

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `description` | string | yes | |
| `effective` | date (`2024-10-01`) or date-time with offset (`2024-10-01T00:00:00Z`) | yes | A date needs `timezone` |
| `timezone` | string | with a date | An IANA name such as `Europe/London` |
| `changes` | list of frames, at least one | one of `changes`, `frames` | |
| `frames` | list of frames, at least one | one of `changes`, `frames` | Equivalent to `changes` |

Each frame has these keys.

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `entity` | `Entity@n`, or a name with `version` | yes | |
| `version` | integer | with an `entity` that has no `@n` | |
| `action` | `SET`, `POST` or `DELETE`, in any case | without `source`, or with a `source` that has no `action` column | `POST` means `SET` |
| `data` | list of objects, at least one | one of `data`, `source` | Keys are field names; a map or list value is stored as JSON |
| `source` | path | one of `data`, `source` | A CSV file relative to the migration file, with a header row of field names |

Fails at validation with `Change set 'Parks' must specify either 'changes' or 'frames', not both`, `Reference 'Park@1' must not also specify a version`, or `<file>: /0/effective '2024-10-01' is a calendar date in the change set's timezone, but the change set has no timezone...`. Fails at rendering with `Error parsing <file>:<line> - <message>` for a CSV that does not parse or a row with an empty action cell, `Frame for entity 'Park v1' specifies action 'SET' but <file> also has an action column` and `Frame for entity 'Park v1' does not specify an action and <file> has no action column`. Fails at install with `Change set 'Parks' references a non existent entity 'Park v1'; existing entities are ...`, `Change set 'Parks' references a non existent field 'wombat' of entity 'Park v1'`, `Entity 'Park v1' has more than one frame with key (code=DC) in change set 'Parks'`, and `<file>: <location> - <Postgres message>` for a row Postgres rejects, where the location is `/0/changes/1/data/2` for inline data, using the key as written, or `./csv/parks/park.csv:18` for a CSV row with the header as line 1. The error keeps Postgres's SQLSTATE.

#### Equivalent forms

The forms in each row mean the same thing, all of them are permanent, and they can be mixed freely.

| Form | Equivalent form |
| ---- | --------------- |
| `fields` as a map of name to type, or to `type` and `nullable` | `fields` as a list of `name`, `type` and optionally `nullable` |
| `key` | `identified_by` |
| `changes` | `frames` |
| `entity: Park@1` in a frame or a dependency | `entity: Park` with `version: 1` |
| `projection: Parks@1` in a hook | `projection: Parks` with `version: 1` |
| `action: SET` | `action: POST` |

`root`, a nest's `entity` and a lookup's `entity` take only the `@n` form. Say the version once: `Park@1` together with `version: 1` fails with `Reference 'Park@1' must not also specify a version`, as `key` with `identified_by`, `changes` with `frames` or `root` with `dependencies` fail with `must specify either ... not both`.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
- operation: ADD_ENTITY
  name: Park
  version: 1
  fields:
    - name: Code
      type: TEXT
    - name: Name
      type: TEXT
      nullable: false
  identified_by:
    - Code

- operation: ADD_CHANGE_SET
  description: Parks
  effective: 2024-10-01T00:00:00Z
  frames:
    - entity: Park
      version: 1
      action: POST
      data:
        - Code: DC
          Name: Devon Cliffs
```

### Names

A canonical name is the name as written, in lower case, with each whitespace character replaced by an underscore. Hook names, enum values and the names of projections are kept as written.

| Name | Canonicalised | Generated name |
| ---- | ------------- | -------------- |
| Entity `Park Season` version 1 | `park_season` | Table `park_season_v1`, function `get_park_season_v1_aggregate(p_change_set_id INTEGER)` |
| Field `Park Code` | `park_code` | Column `park_code`, and the property `park_code` in a document |
| Enum `Customer Type` | `customer_type` | Type `customer_type` |
| Check `park_code_len` | as written | Constraint `chk_park_code_len` |
| Projection `Parks (Detailed)` version 1 | kept as written in the API | Function `get_parks_(detailed)_v1`, quoted where SQL needs it |
| Parameter `code` | `code` | Argument `p_code`, or `p_code_from` and `p_code_to` for `range` |
| Nest `Beach Routes` | `beach_routes` | The property `beach_routes` in a document |

A projection is referred to by its name as written and its version, as `Parks (Detailed)` and `1`, in the API, the HTTP routes and the hooks. The `key` of a projection object is `<name> v<version>`.

### API

Every method that reads the database runs in its own transaction. `Projection`, `ChangeSet`, `Notification` and the other types are declared in `index.d.ts`.

| Method | Behaviour |
| ------ | --------- |
| `new Filby(config)` | Validates the config and creates the connection pool. See [Configuration](#configuration) |
| `filby.init()` | Connects and applies Filby's migrations and then yours, holding the advisory lock `Filby.MIGRATION_LOCK_KEY` throughout, so notifications pause on every instance and the call waits, up to the handler timeout, for any delivery in flight. Rejects if a migration fails or a Filby migration's checksum has changed |
| `filby.startNotifications()` | Starts polling for notifications, and listening when `notifications.listen` is set. Does nothing when already polling |
| `filby.stopNotifications()` | Aborts the signal of every handler in flight, stops listening and polling, and waits for the current delivery to be recorded |
| `filby.stop()` | Stops notifications and ends the pool |
| `filby.subscribe(name, handler)` | Registers `handler(notification, { signal })` for the hook, or for `Filby.NOTIFICATION_ERROR` or `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED`, which receive `{ error, notification }` |
| `filby.unsubscribe(name, handler?)` | Removes the handler, or every handler when none is given |
| `filby.unsubscribeAll()` | Removes every handler from every event |
| `filby.getNotificationStatus()` | Resolves `{ started, poller, lastSuccessfulPollAt, failuresSinceLastSuccess, lastError, pending, overdue, exhausted }`. Rejects when the counts cannot be read |
| `filby.getProjections()` | Resolves every projection as `{ id, name, version, key }`, in no particular order |
| `filby.getProjection(name, version)` | Resolves the projection, or `undefined` |
| `filby.getChangeLog(projection, { since })` | Resolves the change sets that touch the projection's entities, ordered by id, oldest first, superseded ones omitted, and only those with an id greater than `since`, which defaults to 0 |
| `filby.getCurrentChangeSet(projection)` | Resolves the live change set with the latest effective date that is not after the database's current time, or `undefined` |
| `filby.getChangeSet(id)` | Resolves the change set, superseded or not, or `undefined` |
| `filby.getAggregates(changeSetId, name, version)` | Resolves the rows of the entity's aggregate function. Rejects with `Function 'get_park_v2_aggregate' does not exist` or `Change set 42 does not exist` |
| `filby.getDocuments(projection, changeSetId, { parameters, pageOffset, pageSize })` | Resolves `{ documents, total }` for a projection declared with a root. See below |
| `filby.fetch(request, options)` | Serves HTTP. See [HTTP](#http) |
| `filby.withTransaction(callback)` | Passes a [node-pg](https://node-postgres.com/) client to the callback inside a transaction, committed when the callback resolves and rolled back when it rejects |

`getNotificationStatus` reports `started`, whether Filby is polling; `poller`, which is `idle` between polls, `running` during one, `stopped` only transiently during `stopNotifications`, and `undefined` when not polling; `lastSuccessfulPollAt`, `failuresSinceLastSuccess` and `lastError`, as `{ at, message }`, tracked in memory, so they survive `stopNotifications` but not a restart, with the failure count returning to 0 when a poll succeeds and `lastError` keeping the most recent error; and `pending`, the notifications not yet delivered, `overdue`, those whose scheduled time has passed, and `exhausted`, those that have reached `maxAttempts` and will not be retried. An exhausted notification is also overdue.

`getChangeLog` lets a consumer that remembers the last change set id it processed resume from there, and the change sets it returns carry `id`, `effective`, `description`, `lastModified`, `entityTag` and, on a re-issued change set, `reissuedFrom`.

```js
async function catchUp(projection, lastChangeSetId) {
  const changeSets = await filby.getChangeLog(projection, { since: lastChangeSetId });
  for (const changeSet of changeSets) {
    await mirror(projection, changeSet);
  }
}
```

`getDocuments` calls the generated function and returns its rows as documents, each with one array property per nest and one object property per lookup, `null` when the lookup finds no record at the change set, and each nested document likewise carrying what is nested under and looked up from it. `parameters` is keyed by the generated argument names without the `p_` prefix, so `code`, `berths_from`, `berths_to` or `heating`, with values of the type the function expects, an array for `in`; a parameter that is not supplied does not filter, and an unknown one rejects with `Projection 'Parks v1' has no parameter 'wombat'; existing parameters are 'code', 'name'`. `pageOffset` and `pageSize` map to `p_page_offset` and `p_page_size` and are ignored when the projection has no `paging`. `total` is the number of root rows that matched the parameters, whatever the page. Values pass through node-pg at every level, so a timestamp is a `Date` and an array of an enum is an array of strings. A projection declared with `dependencies` rejects with `Projection 'Price List v1' is not declared with a root`; call its function with `withTransaction` instead.

```js
async function getParks(changeSetId, code) {
  const { documents, total } = await filby.getDocuments(projection, changeSetId, { parameters: { code }, pageOffset: 0, pageSize: 50 });
  return { parks: documents, total };
}
```

```js
async function getPriceList(changeSetId) {
  return filby.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM get_price_list_v1($1)', [changeSetId]);
    return rows;
  });
}
```

The static properties are `Filby.NOTIFICATION_ERROR`, the event emitted for every failed poll and delivery attempt; `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED`, the event emitted when the last attempt fails; and `Filby.MIGRATION_LOCK_KEY`, the advisory lock key `102105108098121`, which is distinct from the key marv uses, so other tools can respect it.

### HTTP

`filby.fetch(request, { basePath, info })` serves only `GET`, on these routes relative to `basePath`.

| Route | Query parameters | Status |
| ----- | ---------------- | ------ |
| `/projections` | | 200 |
| `/changelog` | `projection` and `version`, required; `since`, optional | 200; 400 for a missing `projection` or `version`, or a `version` or `since` that is not an integer; 404 for an unknown projection |
| `/projections/<name>/v<n>` without `changeSetId` | Any; they are kept in the redirect | 307 with `Location`; 404 for an unknown projection or one with no current change set |
| `/projections/<name>/v<n>` with `changeSetId` | `changeSetId`; the declared parameters; `page` and `pageSize`, positive integers | 200; 400 for a `changeSetId` that is not an integer or does not exist, an undeclared parameter, a repeated parameter that is not an `in`, a value Postgres cannot convert, `page` or `pageSize` that is not a positive integer, or either on a projection without `paging`; 404 for an unknown projection |
| `/openapi.json` | | 200 |

A projection declared with `dependencies` is served by calling `get_<name>_v<n>(changeSetId)` and returning its rows as they are, all of them unless `pageSize` is given, in which case they are paged by row. `changeSetId`, `page` and `pageSize` are its only query parameters; `page` without `pageSize` is a 400 with `Query parameter 'page' requires 'pageSize'`, and a function that does not exist is a 500 with `Function 'get_price_list_v1' does not exist`. A declared parameter named `page`, `pageSize` or `changeSetId` is unreachable, because the handler reads those names first.

A path that does not match a route is a 404, and a method other than `GET` on a path that does is a 405 with `Allow: GET`. A projection name that cannot be URL-decoded is a 400 with `Malformed projection name '...'`. A Postgres data error, with an SQLSTATE in class 22, is a 400 with Postgres's message; any other error is thrown to the host application. Error bodies are `{ "error": "<message>" }`, for example `Projection 'Parks v1' has no parameter 'wombat'; existing parameters are 'code', 'name'`, or `; it has no parameters`.

| Header | Sent on | Value |
| ------ | ------- | ----- |
| `Content-Type` | Every response with a body | `application/json` |
| `ETag` | A projection response; a change log with entries | The change set's entity tag; the latest entry's. It is the same for every page and parameter combination at a change set, which is correct because the URL carries the page and parameters and the content at a change set never changes, so it is not derived from the content |
| `Last-Modified` | The same | The change set's `lastModified` in RFC 1123 form |
| `Cache-Control` | A projection response | `max-age=31536000, immutable` |
| `X-Total-Count` | A projection response | The number of documents that matched the parameters, whatever the page |
| `Link` | A paged projection response | `<url>; rel="next"` and `<url>; rel="prev"` where those pages exist, preserving every other query parameter |
| `Location` | The redirect | The path and query with `changeSetId` set to the current change set |

### OpenAPI document

`GET /openapi.json` returns an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document. Its `info` is `options.info`, as `{ title, version, description? }`, defaulting to `{ title: 'Filby', version: '1.0.0' }`, and `options.basePath` becomes its single `servers` entry when it is not empty. The paths are `/projections`, `/changelog` and one per projection, with the projection's description where it has one, the operation id `get_<canonical name>_v<n>`, a `changeSetId` parameter, each declared parameter typed from its field, with an `in` parameter as an exploded array and a `range` parameter as its `_from` and `_to` pair, and the paging parameters `page` and `pageSize`, with `page_size` as the default and `page_max` as the maximum, where the projection has paging. The responses document the 200 with its headers, the 307, the 400 and the 404. The components are `Projection`, `ChangeSet` and `Error`.

A root projection's response schema is an array of objects built from the fields it carries, with `additionalProperties: false` and every non-nullable field required; each nest is an array property and each lookup an `anyOf` of its object schema and `null`, both required and both carrying an `x-filby-on` extension mapping the child's join fields to the parent's in canonical names. A projection declared with `dependencies` has only `changeSetId`, `page` and `pageSize` and a response of unconstrained objects, because Filby does not know the shape of its function. Generators ignore specification extensions, but a consumer that compiles the response schemas with Ajv in strict mode must register the keyword with `ajv.addKeyword('x-filby-on')`.

Field types describe what node-pg emits in JSON rather than the Postgres type. The type is matched in lower case with any `(...)` modifier removed, and `[]` makes an array of the element type.

| Postgres type | Schema |
| ------------- | ------ |
| `INTEGER`, `INT`, `INT2`, `INT4`, `SMALLINT`, `SERIAL` | `integer` |
| `BIGINT`, `INT8`, `NUMERIC`, `DECIMAL` | `string`, because node-pg returns them as strings |
| `REAL`, `FLOAT4`, `FLOAT8`, `DOUBLE PRECISION` | `number` |
| `BOOLEAN`, `BOOL` | `boolean` |
| `DATE`, `TIMESTAMP`, `TIMESTAMPTZ`, `TIMESTAMP WITH TIME ZONE`, `TIMESTAMP WITHOUT TIME ZONE` | `string` with format `date-time` |
| `TEXT`, `VARCHAR`, `CHARACTER VARYING`, `CHAR`, `CHARACTER` | `string` |
| `UUID` | `string` with format `uuid` |
| An enum declared with `ADD_ENUM` | `string` with its values as `enum` |
| `JSON`, `JSONB` and any other type | unconstrained |

A nullable field also allows `null`.

### Configuration

| Key | Type | Default | Notes |
| --- | ---- | ------- | ----- |
| `database` | object | | Passed through to node-pg's `Pool`, so any `PoolConfig` key works, and node-pg reads `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` from the environment for anything not given. A `types` entry is wrapped so Filby can add its own parsers |
| `migrations` | list of paths | `['migrations']` | Relative to the working directory |
| `notifications.interval` | duration | `1m` | How often Filby polls for notifications |
| `notifications.initialDelay` | duration | `10s` | The delay before the first poll after `startNotifications` |
| `notifications.maxAttempts` | integer | `10` | Attempts before a notification is exhausted |
| `notifications.maxRescheduleDelay` | duration | `1h` | The longest delay before a retry |
| `notifications.handlerTimeout` | duration | `30s` | How long a handler may run before its signal is aborted and the attempt fails |
| `notifications.listen` | boolean | `false` | Whether to hold a connection that listens for scheduled notifications and polls at once |

Durations such as `30s`, `5m` and `1h` use [parse-duration](https://www.npmjs.com/package/parse-duration) syntax; zero is allowed and a negative or unparseable value is rejected. The config is validated when Filby is constructed: an unknown key fails with `Invalid config: / must NOT have additional property 'wombat'`, or `/notifications must NOT have additional property 'wombat'`, and a bad duration with `Invalid config: /notifications/handlerTimeout must be a duration such as '30s'`. Every schema problem is reported in one error, one per line, and the durations are checked once the schema passes, again all together.

```js
const filby = new Filby({
  database: { user: 'filby', database: 'filby', password: 'filby' },
  migrations: ['path/to/schema/migrations', 'path/to/data/migrations'],
  notifications: {
    interval: '5s',
    initialDelay: '1s',
    maxAttempts: 20,
    maxRescheduleDelay: '30s',
    handlerTimeout: '10s',
    listen: true,
  },
});
```

Run the process that reads data with `TZ=UTC`. node-pg converts `DATE` and `TIMESTAMP` values using the process time zone, so the same row renders differently on machines with different time zones. Filby never uses the process time zone for migrations, so this only affects the values your application reads.

### Command line

```bash
npx filby validate migrations
npx filby preview migrations
```

Both commands scan the directories you name, or `migrations` when you name none. Every YAML and JSON migration is parsed, validated against Filby's schema and rendered to SQL, which reads the CSV files that `source` frames refer to, so a syntax error, a schema violation, a key that names no field, a reference that specifies its version twice, or a missing or malformed CSV file is reported. SQL migrations are not checked. Every file is checked, and each problem is written to stderr as `<file>: <message>`, with the JSON path of the offending value where there is one.

```
migrations/0004.season-2020.yaml: /0 must have required property 'effective'
```

`filby validate` exits with code 1 if any migration failed and 0 otherwise, so it can run in CI. `filby preview` performs the same checks and then writes the SQL to stdout, each directory's migrations in level order and the directories in the order named, each migration preceded by a `-- <file>` comment and SQL migrations copied verbatim, so you can read what a change set will do or diff it in review. If any migration fails, `filby preview` writes the errors, no SQL, and exits with code 1. A command other than `validate` or `preview`, or none, prints `Usage: filby <validate|preview> [directory ...]` and exits with code 1.

The command line tool only reports what can be known from the files. Checks that need a database, such as whether a change set refers to an entity that exists, still happen when `filby.init()` applies the migration.

### Database objects

Filby's own tables are prefixed `fby_`. `fby_entity`, `fby_entity_field`, `fby_entity_check` and `fby_enum` record the entities, their fields with `type`, `identity` and `nullable`, their checks and the enum values. `fby_projection` records the projections with `root_entity_id`, `fields`, `page_size` and `page_max`, `fby_projection_entity` their dependencies, `fby_projection_parameter` and `fby_projection_order` their parameters and order, and `fby_projection_nest`, with `parent_nest_id`, `lookup` and `fields`, `fby_projection_nest_on` and `fby_projection_nest_order` their nests and lookups. `fby_hook` records the hooks and `fby_notification` the notifications with their `status`, `scheduled_for`, `attempts` and `last_error`. `fby_change_set` records the change sets with `effective`, `description`, `last_modified`, `entity_tag`, `superseded_by` and `reissued_from`, `fby_data_frame` the frames with their `action`, and `fby_change_set_entity` which entities each change set touches, which is what the view `fby_projection_change_log_vw` joins to list a projection's change log. Each entity version has its own table, `<entity>_v<n>`, with `fby_frame_id`, `fby_change_set_id` and a column per field, and its aggregate function. A successful notification is kept until the next one for the same hook and projection succeeds.

The functions `fby_schedule_notification`, `fby_notify_add_change_set`, `fby_get_next_notification`, `fby_pass_notification`, `fby_fail_notification` and `fby_reissue_change_sets` implement notifications and re-issuing, and `fby_entity_hint`, `fby_projection_hint` and `fby_entity_field_hint` build the suggestions in error messages. Scheduling a notification sends `NOTIFY fby_notification`, which is what `notifications.listen` listens for. Marv keeps its records in `migrations` and `migrations_lock`.

`filby.init()` holds the advisory lock `Filby.MIGRATION_LOCK_KEY`, `102105108098121`, while migrations run, and each poll takes it in shared mode, so other tools can respect it.

### Migrations

Filby scans every directory in the `migrations` list and applies the combined set of migrations with [marv](https://github.com/guidesmiths/marv) in a single run, so you can split a large set of migrations across several directories, for example one for schema and one for data. YAML, JSON and SQL files are applied; other files are ignored.

Marv groups migrations by namespace. Filby's own migrations use the `filby` namespace and always run first. Your migrations use marv's `default` namespace unless their directory contains a `.marvrc` file declaring another. Within a namespace, marv applies migrations in level order regardless of which directory they came from, so directories sharing a namespace must share one numbering sequence.

```
schema/
  |- 001.define-park-schema.yaml
  |- 003.define-season-schema.yaml
data/
  |- 002.initial-park-data.yaml
  |- 004.initial-season-data.yaml
```

If two directories in the same namespace contain migrations with the same level, `filby.init()` fails with marv's duplicate level error, such as `Migration 1 from namespace: default is duplicated by 001.define-park-schema.yaml, 001.initial-park-data.yaml`. Alternatively, give each directory its own numbering sequence by adding a `.marvrc` with a distinct namespace.

```json
{
  "namespace": "schema"
}
```

Namespaces run one after another in the order they first appear in the `migrations` list, so list a directory before any directory whose migrations depend on it. Directives in a `.marvrc` apply only to the migrations in that directory. For example, the following makes marv re-run every migration in the directory on each `filby.init()`, so they must be idempotent.

```json
{
  "namespace": "views",
  "directives": {
    "audit": false
  }
}
```

Filby verifies the checksums of its own migrations on every `filby.init()`, and fails if one has changed since it was applied. Filby supports upgrading from version 0.14.0 or later; databases created by earlier versions will fail this check. The checksums of your own migrations are not verified.

### Schema and search path

Filby references every object unqualified, so everything lands in the first schema on the connection's search path, which for a new role is `"$user", public`: the role's own schema if one exists, otherwise `public`. To use another schema, create it and grant the Filby role `USAGE` and `CREATE` on it, then point the search path at it, either on the role

```sql
ALTER ROLE filby SET search_path = reference_data;
```

or with the node-pg connection option in the config, which Filby passes to every connection it opens, including marv's.

```js
const filby = new Filby({
  database: { user: 'filby', options: '-c search_path=reference_data' },
});
```

Filby's tables, marv's tables, entity tables, enums, generated functions and your own migration SQL then land in that schema with no other change. Extensions, types and functions that live in `public` must be qualified in projection SQL and entity field types, and connections Filby did not open, such as your application's own pool, must set the same search path or qualify names.

## Example application

The repository includes a [TypeScript](https://github.com/acuminous/filby/tree/main/examples/typescript) example application for a holiday park business that sells static caravans. It is a [Hono](https://hono.dev/) application that mounts `filby.fetch` in one line to serve the change log, the projections and the generated OpenAPI document under `/api`, exposes `filby.getNotificationStatus()` at `/health`, and posts notifications to the webhooks listed in its config. Swagger UI is served at `/documentation` from the generated `/api/openapi.json`, so nobody writes a schema by hand. The eight projections are `Amenities`, `Beaches`, `Catalogue`, `Grades`, `Models`, `Parks (Detailed)`, `Parks (Minimal)` and `VAT Rates`, each served at `/api/projections/<name>/v1`.

The reference data is ten parks with their amenities, the beaches they reach and the routes to them, seasons, offers and the models they sell, a catalogue of manufacturers, models, accessories, prices and VAT rates, and the grades the business maps onto that catalogue. A grade is a set of required attributes, Platinum requiring the most and Saver nothing, and every model holds one grade each year. The catalogue is the manufacturers' data and the grades are the business's own, so `Catalogue` and `Models` carry no grades; a model's grade is found through `Grades`. Every data frame is loaded from a CSV file under `examples/migrations/csv/<change set>/`, one file per entity, so a change set's YAML is its description, its effective date and its sources, each with the action that applies to the whole file; only the two 2026 catalogue files that both add and delete rows carry an action column instead. The ten change sets are:

| Id | Effective | Description |
| -- | --------- | ----------- |
| 1 | 2024-10-01 | Parks |
| 2 | 2025-01-01 | 2025 catalogue and price list |
| 3 | 2025-03-01 | 2025 season |
| 4 | 2025-06-01 | Summer offers |
| 5 | 2026-01-01 | 2026 catalogue and price list |
| 6 | 2026-03-01 | 2026 season and Richmond becomes Skegness |
| 7 | 2026-06-25 | Temporary reduced rate for children's meals and family attractions |
| 8 | 2026-07-01 | Greenacres sold |
| 9 | 2026-09-02 | Temporary reduced rate ends |
| 10 | 2027-01-01 | 2027 catalogue and price list |

The walkthrough below asks five questions of the running example.

### What does Devon Cliffs sell?

Ask `Parks (Detailed)` without a change set id and it redirects to the current one, which is change set 8 because change sets 9 and 10 do not touch any park.

```
GET http://localhost:3000/api/projections/Parks%20(Detailed)/v1?code=DC
```

```
HTTP/1.1 307 Temporary Redirect
location: /api/projections/Parks%20(Detailed)/v1?code=DC&changeSetId=8
```

```
GET http://localhost:3000/api/projections/Parks%20(Detailed)/v1?code=DC&changeSetId=8
```

```json
[
  {
    "code": "DC",
    "name": "Devon Cliffs",
    "address": "Sandy Bay",
    "town": "Exmouth",
    "county": "Devon",
    "postcode": "EX8 5BT",
    "region": "South West",
    "amenities": [
      {
        "amenity": {
          "code": "AMUSEMENT_ARCADE",
          "name": "Amusement Arcade",
          "category": "Entertainment",
          "age_group": "All Ages",
          "charge": "Paid",
          "vat_code": "Family Attraction"
        }
      },
      {
        "amenity": {
          "code": "CRAZY_GOLF",
          "name": "Crazy Golf",
          "category": "Sport",
          "age_group": "All Ages",
          "charge": "Paid",
          "vat_code": "Family Attraction"
        }
      },
      ...
    ],
    "beach_routes": [
      {
        "name": "Along the beach road",
        "distance_metres": 1200,
        "accessibility": "Step Free",
        "beach": {
          "code": "SANDY_BAY",
          "name": "Sandy Bay",
          "surfaces": ["Sandy", "Rocky"]
        }
      },
      {
        "name": "Via the cliff path",
        "distance_metres": 400,
        "accessibility": "Steep Steps",
        "beach": {
          "code": "SANDY_BAY",
          "name": "Sandy Bay",
          "surfaces": ["Sandy", "Rocky"]
        }
      }
    ],
    "seasons": [
      {
        "customer_type": "Guest",
        "current_season_start": "2026-03-16T00:00:00.000Z",
        "current_season_end": "2026-11-03T00:00:00.000Z",
        "next_season_start": "2027-03-16T00:00:00.000Z",
        "next_season_end": "2027-11-03T00:00:00.000Z"
      },
      {
        "customer_type": "Owner",
        "current_season_start": "2026-03-01T00:00:00.000Z",
        "current_season_end": "2027-01-06T00:00:00.000Z",
        "next_season_start": "2027-03-01T00:00:00.000Z",
        "next_season_end": "2028-01-06T00:00:00.000Z"
      }
    ],
    "offers": [
      {
        "grade_code": "Platinum",
        "discount_percent": "0.00"
      },
      {
        "grade_code": "Gold",
        "discount_percent": "2.50"
      },
      ...
    ],
    "models": [
      {
        "model_code": "AMB",
        "model": {
          "name": "ABI Ambleside"
        }
      },
      {
        "model_code": "AVO",
        "model": {
          "name": "Willerby Avonmore"
        }
      },
      ...
    ]
  }
]
```

Devon Cliffs has eight amenities, five offers and eight models; the listing above is cut to two of each. Each park amenity is a row of `Park Amenity` that links a park to an amenity and says nothing else, so the projection declares `fields: []` on the nest and each row is its `Amenity` lookup alone, an object with the amenity's code, name, category, age group, charge and VAT code. Each beach route is a row of `Beach Route` with facts of its own, the distance and how accessible it is, and its `Beach` lookup carries the beach's code, name and surfaces in place of the beach code. Devon Cliffs reaches Sandy Bay two ways, step free along the beach road or down the steep cliff path, so the same beach appears under both routes. Each model the park sells is a code with a `Model` lookup that carries the model's name and nothing more, because a lookup carries only the fields the projection asks for.

`Parks (Minimal)` is the park alone, with the same parameters, order and paging, for a list page or a picker.

```
GET http://localhost:3000/api/projections/Parks%20(Minimal)/v1?code=DC&changeSetId=8
```

```json
[
  {
    "code": "DC",
    "name": "Devon Cliffs",
    "address": "Sandy Bay",
    "town": "Exmouth",
    "county": "Devon",
    "postcode": "EX8 5BT",
    "region": "South West"
  }
]
```

`code` is one of the projection's declared parameters; `name` matches the start of a name and `region` takes a list, as `?region=Scotland&region=Wales`. Both park projections page ten parks at a time, with the total in `X-Total-Count` and the neighbouring pages in `Link`. The season dates are facts about the park, whereas the effective date of change set 6 is when the park started saying so: it took effect on 1 March 2026, the first day of the 2026 season, and replaced each park's current and next season in one step. Haggerston Castle had not announced its 2027 season, so its `next_season_start` and `next_season_end` are null. The offers are by grade, which `Grades` describes: `GET http://localhost:3000/api/projections/Grades/v1?changeSetId=5&code=Gold` returns the attributes a Gold model must have and the models that held Gold each year, each by code, year and name.

### What was in the catalogue on 1 June 2025?

The change log of `Catalogue` says which change set was in force on that date. It lists only the change sets that touch the catalogue's entities, so the parks, seasons and offers are absent, and it includes change set 10, which is dated in the future.

```
GET http://localhost:3000/api/changelog?projection=Catalogue&version=1
```

```json
[
  {
    "id": 2,
    "effective": "2025-01-01T00:00:00.000Z",
    "description": "2025 catalogue and price list",
    "lastModified": "2026-10-23T08:41:25.132Z",
    "entityTag": "754352607d4147f28dff"
  },
  {
    "id": 5,
    "effective": "2026-01-01T00:00:00.000Z",
    "description": "2026 catalogue and price list",
    "lastModified": "2026-10-23T08:41:25.150Z",
    "entityTag": "4c633b39a5e740799a77"
  },
  {
    "id": 10,
    "effective": "2027-01-01T00:00:00.000Z",
    "description": "2027 catalogue and price list",
    "lastModified": "2026-10-23T08:41:25.164Z",
    "entityTag": "fcf3285be59f4f5ea130"
  }
]
```

Change set 2 was in force on 1 June 2025, so `Catalogue` at change set 2 is the whole range as it stood, each manufacturer with its models and each model with the prices and accessories it had then. It has no paging because a product range is read whole; `Models` is the same data one model at a time, with the parameters a search page needs and the manufacturer's name beside its code.

```
GET http://localhost:3000/api/projections/Catalogue/v1?changeSetId=2&code=VIC
```

```json
[
  {
    "code": "VIC",
    "name": "Victory",
    "models": [
      {
        "code": "VER",
        "name": "Victory Vermont",
        "berths": 6,
        "bedrooms": 2,
        "length": "35.0",
        "width": "12.0",
        "heating": "None",
        "double_glazed": false,
        "vat_code": "Holiday Caravan",
        "prices": [
          {
            "year": 2025,
            "list_price": "15995.00"
          }
        ],
        "accessories": [
          {
            "code": "VER-DEC",
            "name": "Decking",
            "price": "3995.00"
          },
          {
            "code": "VER-VER",
            "name": "Veranda",
            "price": "2495.00"
          }
        ]
      }
    ]
  }
]
```

### Which VAT rate applied in August 2026?

From 25 June to 1 September 2026 the rate for children's meals and family attractions was temporarily cut to 5%. Change sets 7 and 9 were entered together when the measure was announced: a rate that is true for ten weeks, loaded once, in advance. A consumer that prices a caravan or an amenity reads `Models` or `Parks (Detailed)` and `VAT Rates` at the same change set and gets one consistent answer.

```
GET http://localhost:3000/api/projections/VAT%20Rates/v1?changeSetId=7
```

```json
[
  {
    "code": "Standard",
    "name": "Standard rate",
    "rate": "20.00"
  },
  {
    "code": "Holiday Caravan",
    "name": "Reduced rate for static holiday caravans",
    "rate": "5.00"
  },
  {
    "code": "Residential Caravan",
    "name": "Zero rate for caravans built to BS 3632",
    "rate": "0.00"
  },
  {
    "code": "Family Attraction",
    "name": "Children's meals and family attractions",
    "rate": "5.00"
  }
]
```

At change set 9 the same request returns `Family Attraction` at `20.00` and nothing else changes.

### What will the 2027 price list be?

Change set 10 exists today and is not yet live. The change log lists it, `Catalogue` at change set 10 returns the 2027 prices, and a request without a change set id still redirects to change set 5, because the current change set is the latest one whose effective date has passed.

```
GET http://localhost:3000/api/projections/Catalogue/v1
```

```
HTTP/1.1 307 Temporary Redirect
location: /api/projections/Catalogue/v1?changeSetId=5
```

```
GET http://localhost:3000/api/projections/Catalogue/v1?changeSetId=10&code=VIC
```

```json
[
  {
    "code": "VIC",
    "name": "Victory",
    "models": [
      {
        "code": "VER",
        "name": "Victory Vermont Classic",
        "berths": 6,
        "bedrooms": 2,
        "length": "35.0",
        "width": "12.0",
        "heating": "None",
        "double_glazed": false,
        "vat_code": "Holiday Caravan",
        "prices": [
          {
            "year": 2025,
            "list_price": "15995.00"
          },
          {
            "year": 2026,
            "list_price": "16450.00"
          },
          {
            "year": 2027,
            "list_price": "16950.00"
          }
        ],
        "accessories": [
          ...
        ]
      }
    ]
  }
]
```

The accessories are there too, at their 2027 prices.

### How is a park renamed, or sold?

A change set is whatever the data owner sends. Richmond became Skegness in change set 6 with one row in `csv/season-2026/park.csv`, which its frame loads with `action: SET`, the same park with its new name, so its seasons, amenities and models follow it:

```
Code,Name,Address,Town,County,Postcode,Region
RI,Skegness,Richmond Drive,Skegness,Lincolnshire,PE25 2SE,Midlands
```

Greenacres was sold in change set 8, which deletes the park and its amenities, beach routes, seasons, offers and models, each from its own file loaded with `action: DELETE`. `csv/greenacres-sold/park.csv` needs only the key:

```
Code
GA
```

`GET http://localhost:3000/api/projections/Parks%20(Detailed)/v1?changeSetId=6&code=RI` returns the park as Skegness with everything it had as Richmond, and `GET http://localhost:3000/api/projections/Parks%20(Minimal)/v1?changeSetId=8&code=GA` returns an empty list with `X-Total-Count: 0`, while both parks are still there at any earlier change set.
