# Filby - A framework for temporal reference data

[![NPM version](https://img.shields.io/npm/v/filby.svg?style=flat-square)](https://www.npmjs.com/package/filby)
[![Node.js CI](https://github.com/acuminous/filby/workflows/Node.js%20CI/badge.svg)](https://github.com/acuminous/filby/actions?query=workflow%3A%22Node.js+CI%22)
[![Codecov](https://codecov.io/gh/acuminous/filby/graph/badge.svg)](https://codecov.io/gh/acuminous/filby)

*There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.*
<p align="right">-<a href="https://www.amazon.co.uk/Time-Machine-H-G-Wells/dp/1614271976">The Time Machine - H. G. Wells</a></p>

## TL;DR
Filby is like source control for reference data but at runtime.

- With SCM systems like git, you have a **commit log** comprising a sequence of **commits**. Each commit is uniquely identified by a **commit hash** and typically bundles related **source code** changes. <br/><br/>
- With Filby, you have a **change log** comprising a sequence of **change sets**. Each change set is uniquely identified by a **change set id** and typically bundles related **reference data** changes.

Like checking out a commit, your applications can use Filby to retrieve reference data for a given change set id. They can also inspect the changelog to find which change set was in effect at a given point in time, and subscribe to reference data update notifications.

See the [example application](#example-applications) for usage.

## Contents
- [The Snapshot Guarantee](#the-snapshot-guarantee)
- [Introduction](#introduction)
- [Benefits](#benefits)
- [Concepts](#concepts)
- [Data Definition](#data-definition)
- [Correcting and Re-issuing Data](#correcting-and-re-issuing-data)
- [API](#api)
- [Configuration](#configuration)
- [Command Line](#command-line)
- [Example Applications](#example-applications)

## The Snapshot Guarantee
A change set id is an immutable snapshot key. Every change set has an effective date, and the data at change set N is everything Filby knew when N was added that was in force on N's effective date. The aggregate function for an entity resolves this from the data frames. For each key it takes the latest frame, by effective date and then by change set id, from the change sets with an id no greater than N and an effective date no later than N's. A record whose latest frame is a DELETE is omitted.

That data never changes. Change set ids come from a sequence, so anything added later has a higher id and falls outside the snapshot, whatever its effective date. Data frames and the rows in the entity tables are only ever inserted, never updated, and each change set is added in a single transaction, so it is either wholly visible or not there at all. When an addition would need to appear under an earlier id, such as backfilled or corrected data, Filby re-issues the affected change sets under new ids and leaves the originals as they were, so `getChangeSet` and `getAggregates` for a superseded id still return the original result. See [Correcting and Re-issuing Data](#correcting-and-re-issuing-data).

This is what makes a change set id safe to build on. Fixing one at the start of a workflow gives consistent reads across every request in it, a response keyed by change set id can be cached indefinitely, and a change set with a future effective date has a fixed id and fixed contents from the moment it is loaded, so it can be fetched and cached ahead of time. See [Benefits](#benefits).

The one exception is deleting a change set, which changes the aggregates of every later change set. It is the escape hatch for data that was never served; see [Deleting a change set](#deleting-a-change-set).

## Introduction
Most applications require reference data that changes slowly over time. This presents the following challenges in a distributed or microservice architecture.

| Challenge     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consistency   | Whenever we duplicate our reference data, we increase the likelihood of inconsistency. Even if we have one authoritive source of truth, we may cache the reference data in multiple systems, resulting in temporary inconsisenty unless cache updates are sychronised. Given the reference data is slow moving, a short period of inconsistency may be acceptable.                                                                                                             |
| Load Times    | Some reference data sets may be too large to desirably load over a network connection for web and mobile applications. Therefore we should discourage accidentally including large data sets into a client bundle, or requesting large data sets over a network.                                                                                                                                                                                                               |
| Reliability   | Requesting data sets over a network may fail, especially when mobile. Bundling local copies of reference data into the application (providing they are not too large) will aleviate this, but increase the potential for stale data.                                                                                                                                                                                                                                           |
| Stale Data    | Even though reference data is slow moving, it will still change occasionally. Therefore we need a strategy for refreshing reference data.                                                                                                                                                                                                                                                                                                                                      |
| Temporality   | When reference data changes, the previous values may still be required for historic comparisons. Therefore all reference data should have an effective date. Effective dates can also be used to synchronise updates by including future records when the values are known in advance. This comes at the cost of increased size, and there may still be some inconsistency due to clock drift and cache expiry times.                                                          |
| Evolution     | Both reference data, and our understanding of the application domain evolves over time. We will at some point need to make backwards incompatible changes to our reference data, and will need to do so without breaking client applications. This suggests a versioning and validation mechanism. The issue of temporality compounds the challenge of evolution, since we may need to retrospecively add data to historic records. In some cases this data will not be known. |
| Local Testing | Applications may be tested locally, and therefore any solution sould work well on a local development machine.                                                                                                                                                                                                                                                                                                                                                                        |

Solving such a complex problem becomes simpler when broken down. This project provides a server side framework for managing temporal reference data. In the following diagram, the mechanism for defining, loading, accessing and receiving notifications about reference data are provided by this framework. The RESTful API and Webhook must be manually created by the application developer. An [example application](#example-applications) is provided to demonstrate how.

<pre>
                         Change
                      Notification                                Webhook
                      ┌─────────┐   ┌──────────────────────────────────────────────────────────────────┐
                      │         │   │                                                                  │
                      │         ▼   │                                                                  ▼
┌────────┐      ┌───────────┬──────────┐              GET /api/changelog?projection=$p&version=$v ┌──────────┐
│        │      │           │          ├──────────────────────────────────────────────────────────│          │
│        │      │           │ Example  │                                                          │          │
│   DB   │◀────▶│   Filby   │   App    │                                                          │  Client  │
│        │      │           │          │ GET /api/projections/:projection/v:version?changeSetId=$c│          │
│        │      │           │          ├──────────────────────────────────────────────────────────│          │
└────────┘      └───────────┴──────────┘                                                          └──────────┘
                      ▲
                      │
                      │
┌─────────────────────────────────────────────┐
│                                             │
│               Reference Data                │
│                 Change Sets                 │
│                                             │
└─────────────────────────────────────────────┘
     ▲           ▲           ▲           ▲
     │           │           │           │
     │           │           │           │
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│         │ │         │ │         │ │         │
│   CSV   │ │  YAML   │ │  JSON   │ │   SQL   │
│         │ │         │ │         │ │         │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
</pre>

The first of the two API calls, namely `/api/changelog` discloses the changes undergone by a projection (a view of the reference data), and provides a set of ids for requesting the projection at a point in time.

```
GET /api/changelog?projection=Catalogue&version=1
```

```json
[
  {
    "id": 2,
    "effective": "2025-01-01T00:00:00.000Z",
    "description": "2025 catalogue and price list",
    "lastModified": "2026-10-21T10:30:08.999Z",
    "entityTag": "6a8f467b146c4695a674"
  },
  {
    "id": 5,
    "effective": "2026-01-01T00:00:00.000Z",
    "description": "2026 catalogue and price list",
    "lastModified": "2026-10-21T10:30:09.015Z",
    "entityTag": "3e13cd64b7be4e29a14b"
  },
  {
    "id": 10,
    "effective": "2027-01-01T00:00:00.000Z",
    "description": "2027 catalogue and price list",
    "lastModified": "2026-10-21T10:30:09.030Z",
    "entityTag": "bddaac93c92a45b19983"
  }
]
```

The second API call, namely `/api/projections/:projection/v:version` will return the reference data, correct at the time of the given changeSetId.

```
GET /api/projections/Catalogue/v1?changeSetId=2&code=VIC
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

Both API calls are served by `filby.fetch`, which the example application mounts in one line. If the changeSetId is omitted, the client is redirected to the projection at the current change set, which is the latest one whose effective date has passed.

```
GET /api/projections/Catalogue/v1
```

```
HTTP/1.1 307 Temporary Redirect
location: /api/projections/Catalogue/v1?changeSetId=5
```

## Benefits

At first glance, accessing projections via change sets may seem an unnecessary overhead, however it provides a number of worthy benefits.

1. Reference data can be safely released (and potentially pre-cached) ahead of time.
2. Clients can receive consistent reference data by fixing the changeSetId at the start of a transaction.
3. Clients can receive the latest reference data by updating to the latest changeSetId when one becomes available.
4. The changeSetId makes for an excellent cache buster, enabling the projection responses to be cached indefinitely.
5. Projections provide multiple views of the same reference data, and can therefore be tailored to the needs of each client.
6. Versioned projections supports backwards incompatible changes

Refering back to the previous list of challenges:

- **Consistency** is solved by the changeSetId mechanic.
- **Load Times** can be reduced because the solution is designed to be highly cacheable. Furthermore, response sizes can abe reduced by tailoring projections to the needs of the clients. Finally, network requests can be avoided completely by maintaining a local copy of the projected reference data.
- **Stale Data** can be prevented through use of the effective date, deploying reference data ahead of time and checking the changelog for updates. Clients can also be advised of updates via change notifications
- **Historic** data still accessible by using a previous changeSetId.
- **Evolution** of reference data is supported by versioned entities and projections.
- **Local Testing** is possible through HTTP mocking libraries.

## Concepts
Filby has the following important concepts
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


### Entity
An *Entity* represents a type of reference data. Entities may be stand alone, or form an object graph. We use a holiday park business as an example, in which a 'Park' entity has many 'Park Season' entities and a 'Manufacturer' entity has many 'Model' entities. An entity is declared with a name, a version, its fields, the key fields that identify one record, and optionally some checks. A field may be of any PostgreSQL type, including an enum declared with `ADD_ENUM` and extended with `ALTER_ENUM`, so the database enforces the set of permitted values. Checks become PostgreSQL check constraints on the entity's table. Evolving reference data means adding version 2 of an entity alongside version 1 rather than altering it in place, so a reference to an entity always names the version, as `Park@1` or as `entity: Park` with `version: 1`. The key may be written as `key` or `identified_by`; see [Equivalent forms](#equivalent-forms). The records of an entity are stored as *Data Frames* and read back through its *Aggregate*, both described below.

### Data Frame
A *Data Frame* is a snapshot of one entity record, taken as part of a *Change Set*. There are two types of data frame: `SET` records the values of the record at a point in time, and `DELETE` records that the record has been deleted. `POST` is an equivalent form of `SET`. Data frames are only ever inserted, never updated, so the history of a record is the sequence of its frames.

### Change Set
A *Change Set* groups data frames, potentially for different entities, into a single unit with a common effective date, which is the date from which its frames are in force. The effective date may be in the future, so reference data can be loaded ahead of time. It is not a date in the data: a park season's start and end are facts about the park, whereas the effective date of the change set that carries them is when the park started saying so. Each change set is identified by an id from a sequence and is added in a single transaction, so it is either wholly visible or not there at all, and its id is an immutable snapshot key; see [The Snapshot Guarantee](#the-snapshot-guarantee). In the DSL the frames of a change set are listed under `changes`, or equivalently `frames`.

### Aggregate
An *Aggregate* is the state of an entity at a change set: one row per key, resolved from the entity's data frames by the rule in [The Snapshot Guarantee](#the-snapshot-guarantee), with a record whose latest frame is a `DELETE` omitted. Filby creates an aggregate function for each entity version, with the signature `get_<entity>_v<version>_aggregate(p_change_set_id INTEGER)`. Entity, field, enum and nest names may be written in Title Case with spaces, as `Park Season`; Filby canonicalises them to lower case with underscores for tables, columns, types and functions, and in the documents it serves, so the aggregate of version 1 of the 'Park Season' entity is `get_park_season_v1_aggregate` and its 'Park Code' field is the column `park_code`. Projection names are kept as written, so a projection declared as `Parks` is `Parks` in the API. Projections are built on these functions, and `getAggregates` calls them for you.

### Projection
A *Projection* is a versioned view of one or more entities, made available in the example application via a RESTful API. Most projections are declared in the DSL by naming a root entity, and Filby generates a function that returns one row per root record at a given change set, with optional parameters for filtering, a declared order and paging. One-to-many related entities can be nested under the root with a `nest` block, and a nested entity can nest its own children to any depth, each level joining to its parent. A many-to-one entity, such as the amenity a park amenity refers to, is embedded as a single object rather than a list with a `lookup` block, at the root or under any nest. `getDocuments` assembles one document per root record with the related records embedded at every level, with paging still counting root records. The projection's dependencies, the entities whose change sets affect it, are derived from the root and the nested and looked-up entities. When a projection needs a shape the DSL cannot express, write the SQL yourself over the aggregate functions and declare the entities it depends on instead, so Filby still knows which projections a change set affects. A reference to a projection always names the version, as `parks@1` or as `projection: parks` with `version: 1`.

### Hook
A *Hook* pairs a unique name with an *Event*. Your application registers a handler for the hook by name with `filby.subscribe`, and can handle the event how it chooses, e.g. by making an HTTP request, or publishing a message to an SNS topic. Unlike node events, the handlers are asynchronous. It is advised not to share hooks between handlers since if one handler fails but another succeeds the built in retry mechanism will re-notify both handlers.

There are four events. `ADD_PROJECTION` and `DROP_PROJECTION` fire when a projection is added or dropped. `ADD_CHANGE_SET` fires when a change set is added, whatever its effective date. `COMMENCE_CHANGE_SET` fires when a projection's current change set changes, i.e. whenever `getCurrentChangeSet` would start returning something different: immediately for a change set whose effective date has already passed, and on the effective date for one loaded ahead of time. A projection's current change set is the one with the latest effective date that is not in the future; earlier change sets lapse silently. An `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET` hook may be projection specific, naming the one projection it is interested in, or general, firing for every projection. `ADD_PROJECTION` and `DROP_PROJECTION` hooks are always general. A mirror such as a data lake subscribes to `ADD_PROJECTION` to learn about new data sets, `ADD_CHANGE_SET` to refresh them and `DROP_PROJECTION` to retire them, whereas a consumer that caches current data subscribes to `COMMENCE_CHANGE_SET` so it hears about next year's rates when they take effect rather than when they are loaded.

### Notification
A *Notification* is raised for a hook and a projection whenever the hook's event occurs for that projection, and is delivered by calling the hook's handler. The notification says which hook fired and which projection changed; call `getChangeLog` or `getCurrentChangeSet` for the detail. By subscribing to notifications, downstream systems can maintain copies of the data, with reduced risk of it becoming stale. For example, the subscriber could be another backend system, caching proxy, a web application, a websocket application, a CI / CD pipeline responsible for building a client side data module, or an ETL process for exporting the reference data to the company data lake.

Notifications are retried a configurable number of times using an exponential backoff algorithm. It is safe for multiple instances of the framework to poll for notifications concurrently. Each notification is claimed and delivered inside a single database transaction, which holds a row lock for the duration of the handler, so other instances skip it and each notification is delivered by only one instance. Notifications pause while migrations run. `filby.init()` holds an exclusive advisory lock for the duration of the migrations, and each poll takes the same lock in shared mode, so no new delivery starts on any instance until the migrations have finished, and a migration waits for deliveries already in flight to complete. A migration, and therefore `filby.init()`, can wait up to the handler timeout for an in-flight delivery of the same hook and projection, so keep `handlerTimeout` short. The advisory lock key is `102105108098121` (available as `Filby.MIGRATION_LOCK_KEY`), which is distinct from the key Marv uses to serialise migrations, so other tools can respect it. With `notifications.listen` enabled, Filby also holds a dedicated connection that `LISTEN`s for the `NOTIFY` sent whenever a notification is scheduled and polls immediately, so `ADD_CHANGE_SET`, `ADD_PROJECTION` and `DROP_PROJECTION` are delivered without waiting for the next interval, while polling remains the safety net because a `NOTIFY` sent while that connection is down is lost, and `COMMENCE_CHANGE_SET` is always delivered by the poll since a change set reaching its effective date is not a database write.

## Data Definition
All of above objects (Projections, Entities, Data Frames, etc) are defined using a domain specific language, which is dynamically converted into SQL and applied using a database migration tool called [Marv](https://www.npmjs.com/package/marv). Names may be written in Title Case with spaces and are canonicalised as described under [Aggregate](#aggregate). Whenever you need to make an update, simply create a new JSON or YAML migration file in the configurable migrations folder. The JSON schema is published at https://acuminous.github.io/filby/lib/schema.json, and a YAML migration that starts with the `# yaml-language-server` comment shown below is validated and completed as you type by any editor with YAML language server support, such as VS Code with the YAML extension.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0001.define-schema.yaml

# Add enums for your reference data
# Equivalent of PostgreSQL's CREATE TYPE statement
- operation: ADD_ENUM
  name: Customer Type
  values:
    - Guest
    - Owner

# Add values to an existing enum, after its current values
# Equivalent of PostgreSQL's ALTER TYPE ... ADD VALUE statement
# A change set that uses a new value belongs in a later migration file, because
# Postgres cannot use a new enum value in the transaction that added it
- operation: ALTER_ENUM
  name: Customer Type
  add:
    - Staff

# Adding entities performs the following:
# 1. Inserts a row into the 'fby_entity' table, and records its fields and checks in 'fby_entity_field' and 'fby_entity_check'
# 2. Creates a table 'park_v1' for holding reference data
# 3. Creates an aggregate function 'get_park_v1_aggregate' to be used by projections
- operation: ADD_ENTITY
  name: Park
  # version defaults to 1
  fields:
    Code: TEXT # Any valid PostgreSQL type (including enums) is supported
    Name:
      type: TEXT
      nullable: false # Recorded in fby_entity_field; fields are nullable unless you say otherwise
  key:
    - Code # Used to aggregate the data frames

  # Creates PostgreSQL check constraints
  checks:
    park_code_len: (LENGTH(code) = 2)

# A park has a season for each type of customer: the season running now and the
# one after it, which the park may not have announced yet
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

# Defining projections
# A projection names a root entity and Filby generates a function, here get_parks_v1,
# that returns one row per root entity at the given change set. The root is also the
# projection's dependency, which Filby uses to work out what projections are affected
# by reference data updates
- operation: ADD_PROJECTION
  name: Parks
  # version defaults to 1
  description: Parks with their seasons
  root: Park@1 # References always name the version
  # Each parameter becomes a nullable function argument, p_code and p_name here, which
  # filters the rows when supplied. match defaults to equals; prefix matches the start
  # of the field literally, in takes an array, range takes p_<name>_from and
  # p_<name>_to, each optional and inclusive, and gt, gte, lt and lte compare the field
  # with p_<name>, so gt and lte on the same field make a half-open interval. Parameters
  # combine with AND. change_set_id, page_offset and page_size are reserved names
  parameters:
    code:
      field: Code
    name:
      field: Name
      match: prefix
  # Root fields to sort by. direction is ASC (the default) or DESC, and nulls is FIRST or
  # LAST, otherwise Postgres decides. The entity key is always appended, ascending, as a
  # tie break, and is the order when none is declared
  order:
    - field: Name
      direction: DESC
      nulls: LAST
    - field: Code
  # Adds p_page_offset (default 0) and p_page_size (default page_size, never more than
  # page_max) arguments and an fby_total column holding the number of rows that matched
  # the parameters. The function is then
  # get_parks_v1(p_change_set_id, p_code, p_name, p_page_offset, p_page_size)
  paging:
    page_size: 10
    page_max: 50
  # Nests child entities under each root row. The generated function is unchanged, but
  # filby.getDocuments returns one document per root row with a property per entry,
  # here seasons, holding a list of the child's fields, except the join fields, in the
  # nested order (the child's key is appended as a tie break), or an empty list when
  # the root has no children. A page is N parks with all their seasons, and the total
  # counts parks. The nested entities are dependencies of the projection too, so a
  # change set for a season notifies the hooks below
  nest:
    Seasons:
      entity: Park Season@1
      # Maps the child's field to the parent's field, here the root's
      on:
        Park Code: Code
      order:
        - field: Customer Type

# An entry may nest its own children in the same way, to any depth, each level joining
# to its parent. Here each manufacturer holds its models and each model holds its prices
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
          # Maps the price's field to the model's field
          on:
            Model Code: Code
          order:
            - field: Year

# A lookup embeds a many-to-one entity as a single object rather than a list. The root
# and any nest may declare lookups alongside their nests, and each names an entity and
# a join exactly as a nest does, but the join must cover the whole key of the looked-up
# entity, so a parent finds at most one record, and gets null when there is none at the
# change set. A lookup has no order and no nests or lookups of its own; nest the entity
# instead if it needs children. A nest and a lookup may not share a name at one level,
# and a looked-up entity is a dependency of the projection too. Here each park amenity
# carries the amenity it refers to, so a document has the amenity's name, category and
# charge beside its code, which stays on the park amenity as the join field
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  root: Park@1
  nest:
    Amenities:
      entity: Park Amenity@1
      on:
        Park Code: Code
      order:
        - field: Amenity Code
      lookup:
        Amenity:
          entity: Amenity@1
          # Maps the amenity's field to the park amenity's field
          on:
            Code: Amenity Code

# A projection whose SQL you write yourself (see the custom SQL migration below)
# declares the entities it depends on instead of a root. Filby still knows which
# change sets affect it, and filby.fetch serves it by calling get_price_list_v1
- operation: ADD_PROJECTION
  name: Price List
  dependencies:
    - entity: Model@1
    - entity: Price@1
    - entity: VAT Rate@1

# A hook defines an asynchronous event that will be emitted by the framework whenever the
# reference data the projection changes.

# This is a projection specific hook which fires when a change set
# for the specified projection is added, whatever its effective date.
# Only ADD_CHANGE_SET and COMMENCE_CHANGE_SET hooks can be projection specific
- operation: ADD_HOOK
  name: sns/add-change-set/parks-v1 # Must be unique
  event: ADD_CHANGE_SET
  projection: Parks@1

# This hook fires when a change set for the specified projection takes
# effect: immediately if its effective date has already passed, otherwise
# on the effective date
- operation: ADD_HOOK
  name: sns/commence-change-set/parks-v1 # Must be unique
  event: COMMENCE_CHANGE_SET
  projection: Parks@1

# This is a general hook that fires when the data
# supporting any projection changes
- operation: ADD_HOOK
  name: data-lake/add-change-set/* # Must be unique
  event: ADD_CHANGE_SET
```

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0003.initial-data.yaml

# Add a change set containing one or more changes to the previously defined entities
- operation: ADD_CHANGE_SET
  description: Parks
  # The date the change set takes effect. A calendar date is midnight
  # in the change set's timezone, which must be an IANA name
  effective: 2024-10-01
  timezone: Europe/London
  changes:
    - entity: Park@1
      # SET or DELETE, in any case
      action: SET
      data:
          # Adds a data frame for Devon Cliffs
        - Code: DC
          Name: Devon Cliffs
          Region: South West
          # Adds a data frame for Primrose Valley
        - Code: PV
          Name: Primrose Valley
          Region: Yorkshire

    - entity: Park@1
      # Adds a data frame that will delete the entity identified
      # by code HF from the effective data
      action: DELETE
      data:
        - Code: HF

      # YAML can get verbose, so you can also import data frames from a local CSV
      # The source path is relative to the directory containing the migration file
      # The CSV requires a header row with the column names of your entity.
      # Without an action on the frame, the CSV must have an action column
      # and every cell in it must be filled. When deleting data you only
      # need to include the fields that identify the entity
    - entity: Park@1
      source: ./csv/parks/park.csv
      # action,Code,Name,Region
      # SET,KP,Kiln Park,Wales
      # SET,RP,Rockley Park,South West
      # DELETE,TP,,

      # An action on the frame applies to every row of the CSV,
      # which must not have an action column
    - entity: Price@1
      action: SET
      source: ./csv/catalogue-2025/price.csv
      # Model Code,Year,List Price
      # RIO,2025,24995.00
      # AVO,2025,29995.00
```

The effective date may be a calendar date, such as `2024-10-01`, or a timestamp with an explicit offset, such as `2024-10-01T00:00:00Z`. A calendar date is midnight in the change set's `timezone`, so the stored effective date follows daylight saving time, and a bare date without a `timezone` is rejected: Filby never uses the process timezone, because the same migration would render differently on different machines. A timestamp with an explicit offset is stored as written, with or without a `timezone`.

A field with no value is stored as NULL, and a nested map or list is stored as JSON so it can be loaded into a JSON or JSONB column. CSV cells are read as text and cast by Postgres to the column type, so a code such as `007` keeps its leading zeros in a TEXT column, `1.50` is stored as `1.50` in a NUMERIC column, and `abc` in an INTEGER column fails the migration. An empty CSV cell is stored as NULL. A field or CSV column that the entity does not declare fails the migration.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0013.drop-unused-objects.yaml

# Deletes the specified enum
# Fails if the enums are still use
- operation: DROP_ENUM
  name: Customer Type

# Deletes the specified entity
# Fails if the entities are depended on by projections or used in change sets
- operation: DROP_ENTITY
  name: Park
  version: 1

# Deletes the specified projection and associated hooks
# Fails if the entities are still depended on by projections
- operation: DROP_PROJECTION
  name: Parks
  version: 1

# Deletes the specified hook and associated notifications
- operation: DROP_HOOK
  name: sns/add-change-set/parks-v1
```

### Equivalent forms
Some parts of the DSL can be written in more than one way. The forms in each row below mean the same thing, all of them are permanent, and they can be mixed freely, so migrations written for earlier versions of Filby keep working unchanged.

| Form | Equivalent form |
| ---- | --------------- |
| `fields` as a map of name to type, or to `type` and `nullable` | `fields` as a list of `name`, `type` and optionally `nullable` |
| `key` | `identified_by` |
| `changes` | `frames` |
| `entity: park@1` | `entity: park` with `version: 1` |
| `projection: parks@1` | `projection: parks` with `version: 1` |
| `action: SET` | `action: POST` |

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

`version` defaults to 1 on `ADD_ENTITY` and `ADD_PROJECTION`, and nowhere else. A change, a projection dependency or a hook must say which version it refers to, either as `park@1` or with a `version` property, because a defaulted reference would silently write to the wrong version once version 2 exists. Say it once: `park@1` together with `version: 1` is an error, as is `key` together with `identified_by`, or `changes` together with `frames`.

Fields are nullable unless declared `nullable: false`, and key fields are never nullable. Each field's nullability is recorded in `fby_entity_field` for tooling to read. It is not yet enforced on the entity table, because a `DELETE` frame carries only the key fields.

The DSL deliberately omits the ability to drop change sets and data frames since they are supposed to be immutable. However, since Marv works with SQL, you can also use it for regular database migrations. One use is deleting a change set that was never served, see [Correcting and Re-issuing Data](#correcting-and-re-issuing-data). Another is adding custom views or functions over the aggregated data frames to make your projections more efficient. Simply create a SQL migration file in the migrations directory instead of a YAML or JSON one. The function below serves the `Price List` projection declared above. It joins three aggregates at the same change set, so a price and the VAT rate that applies to it always come from one snapshot, which is why the projection declares all three entities as dependencies.

```sql
-- migrations/0004.create-get-price-list-v1-function.sql
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

Declare such functions `STABLE`, since their results depend on the change sets in the database, and do any caching in the application. The aggregates for a change set never change, so a cache keyed by projection, version and change set id needs no invalidation, but every new change set is a new key, so bound it with an LRU or TTL cache rather than an unbounded map. This is the in-process complement to using the change set id as an HTTP cache buster.


## Correcting and Re-issuing Data
The aggregates for a change set include the frames from every change set with a lower or equal id and an earlier or equal effective date. This only works while change set ids follow effective dates, which pre-releasing or backfilling data would break. Filby keeps them in order by re-issuing change sets.

When you add a change set, Filby re-issues every live change set with a later effective date. A re-issued change set has a new id, the same description, effective date and data frames as the original, and `reissuedFrom` set to the original's id. The original is superseded: `getChangeLog` and `getCurrentChangeSet` no longer return it, but `getChangeSet` and `getAggregates` still do, with their original results, so anything cached by its id stays correct. A re-issued change set schedules `ADD_CHANGE_SET` notifications like any other.

This means adding one change set can add more than one entry to the change log. For example, given change set 1 effective 2026-01-01 and a pre-released change set 2 effective 2027-01-01, adding change set 3 effective 2026-06-01 re-issues change set 2 as change set 4. The change log becomes 1, 3, 4, and the aggregates for change set 4 include the data from change set 3.

Adding a change set with the same effective date as an existing one re-issues nothing. The new change set wins because it has the higher id.

### Correcting data
To fix a change set that was published with the wrong data, add a change set with the same effective date and the corrected frames. The higher id wins the tie, so the correction overrides the original from that date onwards, clients following the current change set see it immediately, and the original snapshot is unchanged for anyone who cached it. Any pre-released change set with a later effective date is re-issued as usual.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0005.correct-initial-data.yaml
- operation: ADD_CHANGE_SET
  description: Initial Data (corrected)
  effective: 2019-01-01T00:00:00Z
  changes:
    - entity: park@1
      action: SET
      data:
        - code: PV
          name: Primrose Valley Holiday Park
```

### Deleting a change set
Deleting a change set is the escape hatch for one that was never served. The aggregates of every later change set change, so anything cached by id is wrong afterwards. The delete cascades to the change set's data frames and to their rows in the entity tables, so delete the change set rather than its data frames. If you delete every data frame for an entity in a change set, the change set still appears in the change log of projections that use that entity, with correct but redundant aggregates.

```sql
-- migrations/0006.delete-a-change-set.sql
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

## API
Filby provides a set of lifecycle methods and an API for retrieving change sets and projections, and for executing database queries.

#### new Filby(config: Config)
Constructs a new Filby instance

#### filby.init(): Promise&lt;void&gt;
Connects to the database and runs schema/data migrations. Holds the advisory lock `Filby.MIGRATION_LOCK_KEY` while the migrations run, so notifications are paused on every instance and the call waits for any delivery already in flight, up to the handler timeout.

#### filby.stop(): Promise&lt;void&gt;
Stops polling for notifications then disconnects from the database

#### filby.startNotifications(): Promise&lt;void&gt;
Starts polling the database for notifications. Does nothing if Filby is already polling.

#### filby.stopNotifications(): Promise&lt;void&gt;
Stops polling the database for notifications, aborts the signal passed to any inflight handlers, and waits for the current delivery to be recorded.

#### filby.getNotificationStatus(): Promise&lt;NotificationStatus&gt;
Reports the state of the notification poller and queue for health checks. `started` is whether Filby is polling. `poller` is `idle` between polls, `running` while a poll is in progress, `stopped` only transiently during `filby.stopNotifications()`, and `undefined` whenever Filby is not polling. `lastSuccessfulPollAt`, `failuresSinceLastSuccess` and `lastError` (`at` and `message`) are tracked in memory, so they survive `filby.stopNotifications()` but not a process restart. `failuresSinceLastSuccess` returns to 0 when a poll succeeds, whereas `lastError` keeps the most recent poll error. `pending` counts the notifications that have not yet been delivered, `overdue` those whose scheduled time has passed, and `exhausted` those that have reached `maxAttempts` and will not be retried. An exhausted notification is also overdue. A growing `overdue` count while polls succeed means handlers are failing. The counts come from a single query, so the method rejects when the database is unavailable, which is what a health check should do. `Filby.NOTIFICATION_ERROR` remains the as-it-happens signal, emitted for polling failures and for every failed delivery attempt, e.g.

```js
app.get('/health', async (c) => {
  const status = await filby.getNotificationStatus();
  return c.json(status, status.started && status.failuresSinceLastSuccess === 0 ? 200 : 503);
});
```

#### filby.subscribe&lt;T&gt;(event: string, handler: (notification: T, context: HandlerContext) => Promise&lt;void&gt;): void
Under the hood, Filby uses [eventemitter2](https://www.npmjs.com/package/eventemitter2) which unlike node's EventEmitter, supports asynchronous events. You can use these to listen for hooks and perform of asynchronous tasks like making an HTTP request for a webhook. The hook name is user defined and must be specified in the Hook [Data Definition](#data-definition). The first callback parameter is the Notification context (see the TypeScript definitions). The second is an object with an [AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal), which Filby aborts if the handler exceeds the configurable `handlerTimeout` (default 30 seconds) or when `filby.stopNotifications()` or `filby.stop()` is called. Pass the signal to anything that accepts one, such as `fetch`, and check `signal.aborted` between steps in longer handlers, e.g.

```js
filby.subscribe('VAT Rate changed', async (notification, { signal }) => {
  await fetch('https://httpbin.org/status/200', { method: 'POST', body: JSON.stringify(notification), signal });
});
```

A handler that exceeds the timeout is treated as having failed and is retried like any other failure. Since a promise cannot be cancelled, a handler that ignores the signal may still complete after Filby has recorded the failure, so handlers must be idempotent. At-least-once delivery already requires this, because a handler can also complete just before its process is killed.

If your event handler throws an exception it will be caught by Filby and the notifiation retried up to a configurable number of times, with an incremental backoff delay. A hook with no subscriber is treated as a failure too: the notification is recorded with the error `No subscribers for hook '...'` and retried like any other failure, so subscribe before calling `startNotifications`, and check that the event name matches the hook name exactly. Every failed attempt emits `Filby.NOTIFICATION_ERROR` with the attempt's error and the notification, once the failure has been recorded. If the maximum attempts are exceeded then Filby additionally emits a dedicated hook, `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED`, with the same payload. The sole callback parameter is the NotificationError context (see the TypeScript definitions), e.g.

```js
filby.subscribe(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, ({ error, notification }) => {
  console.error('Hook Failed', notification);
  console.error('Hook Failed', error.stack); // Careful not to log secrets that may be on the error
});
```

Both events are emitted synchronously and an error thrown by a listener is discarded, so catch errors inside the listener.

If polling the database for notifications fails, for example because the database is briefly unavailable, Filby emits `Filby.NOTIFICATION_ERROR` and polls again at the next interval. Errors raised by the connection pool, such as the server closing an idle connection, are reported through the same event. The sole callback parameter is the NotificationError context (see the TypeScript definitions), e.g.

```js
filby.subscribe(Filby.NOTIFICATION_ERROR, ({ error }) => {
  console.error('Notification polling failed', error.stack); // Careful not to log secrets that may be on the error
});
```

#### filby.unsubscribe&lt;T&gt;(event: string, handler?: (notification: T, context: HandlerContext) => Promise&lt;void&gt;): void
Unsubscribes the specified handler, or all handlers if none is specified, from the specified event

#### filby.unsubscribeAll(): void
Unsubscribes all handlers from all events

#### filby.getProjections(): Promise&lt;Projection[]&gt;
Returns the list of projections.

#### filby.getProjection(name: string, version: number): Promise&lt;Projection&gt;
Returns the specified projection.

#### filby.getChangeLog(projection: Projection, options?: { since?: number }): Promise&lt;ChangeSet[]&gt;
Returns the change log for the given projection, ordered by change set id, oldest first; superseded change sets are omitted. Pass `since` to return only the change sets with a higher id, so a consumer that remembers the last change set id it processed can resume from there.

```js
async function catchUp(projection, lastChangeSetId) {
  const changeSets = await filby.getChangeLog(projection, { since: lastChangeSetId });
  for (const changeSet of changeSets) {
    await mirror(projection, changeSet);
  }
}
```

#### filby.getCurrentChangeSet(projection: Projection): Promise&lt;ChangeSet&gt;
Returns the current changeset for the given projection based on the database's current time.

#### filby.getChangeSet(changeSetId: number): Promise&lt;ChangeSet&gt;
Returns the specified change set

#### filby.getAggregates&lt;T&gt;(changeSetId: number, name: string, version: number): Promise&lt;T[]&gt;
Returns aggreated entity data for the specified changeSetId. The sort order will be in order of the entity's identifier fields (ascending, nulls last). Rejects with `Function 'get_park_v1_aggregate' does not exist` if there is no such entity, and with `Change set 42 does not exist` if there is no such change set.

```js
async function getParks(changeSetId) {
  const rows = await filby.getAggregates(changeSetId, 'Park', 1);
  return rows.map(toParkStructure);
};
```

#### filby.getDocuments&lt;T&gt;(projection: Projection, changeSetId: number, options?: DocumentOptions): Promise&lt;Documents&lt;T&gt;&gt;
Calls the function generated for a projection declared with a `root` and returns its rows as documents, each with one array property per `nest` entry and one object property per `lookup` entry, `null` when the row finds no record at the change set, and each nested document likewise carries the entries nested under and looked up from it, to the declared depth. `parameters` is keyed by the generated argument names without the `p_` prefix, so `code`, `rate_from`, `rate_to` or `types`, with values of the type the function expects (an array for `in`); a parameter that is not supplied does not filter, and an unknown one rejects with `Projection 'parks v1' has no parameter 'wombat'; existing parameters are 'code', 'name'`. `pageOffset` and `pageSize` map to `p_page_offset` and `p_page_size` and are ignored when the projection has no `paging`. `total` is the number of root rows that matched the parameters, whatever the page. Nested values pass through [node-pg](https://node-postgres.com/) exactly as the root's do, so a timestamp is a `Date` at either level. Rejects with `Projection 'park v1' is not declared with a root` for a projection declared with `dependencies`; call its function directly instead.

```js
async function getParks(changeSetId, code) {
  const { documents, total } = await filby.getDocuments(projection, changeSetId, { parameters: { code }, pageOffset: 0, pageSize: 50 });
  return { parks: documents, total };
};
```

#### filby.fetch(request: Request, options?: FetchOptions): Promise&lt;Response&gt;
Serves projections and change logs over HTTP using the web standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) and [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response), so it has no framework dependency. Routes are relative to `basePath` (default `''`), only `GET` is served (anything else is a 405), an unknown path is a 404 and every error is JSON `{ "error": "..." }`.

- `GET /projections` returns the projections as a JSON array of `{ name, version, description }` in name and version order, `description` null when none was declared. The list changes when a projection is added or dropped, so it is served without cache headers.
- `GET /changelog?projection=<name>&version=<n>[&since=<id>]` returns the projection's change log as `getChangeLog` does, with `ETag` and `Last-Modified` from the latest entry. A projection with no change sets, or with nothing after `since`, is an empty list without `ETag` or `Last-Modified`. A missing `projection` or `version`, or a `version` or `since` that is not an integer, is a 400; an unknown projection is a 404.
- `GET /projections/<name>/v<n>` redirects (307) to the same URL with `changeSetId` set to the projection's current change set, keeping any other query parameters, or is a 404 when the projection has no current change set. The name is URL-encoded, so `/projections/VAT%20Rates/v1`.
- `GET /projections/<name>/v<n>?changeSetId=<id>[&<parameter>=<value>...][&page=<n>][&pageSize=<n>]` returns the documents or rows at that change set as a JSON array. A `changeSetId` that is not an integer or does not exist is a 400. For a projection declared with a `root`, the parameters are the names `getDocuments` accepts (`code`, `rate_from`, `rate_to`, `types`), an `in` parameter is repeated (`?types=a&types=b`), and any other key, a repeated key that is not an `in`, or a value Postgres cannot convert to the field's type is a 400. `page` is 1-based and `pageSize` defaults to the declared `page_size` and is clamped to `page_max`; either on a projection without `paging` is a 400, and a declared parameter named `page` is unreachable, since the handler reads it. A projection declared with `dependencies` is served by calling `get_<name>_v<n>(changeSetId)` and returning its rows as they are, all of them unless `pageSize` is given, in which case they are paged by row; `changeSetId`, `page` and `pageSize` are its only query parameters, and a 500 reports a function that does not exist. Responses carry `ETag` (the change set's entity tag), `Last-Modified`, `Cache-Control: max-age=31536000, immutable`, `X-Total-Count` (the number of documents that matched the parameters, whatever the page) and `Link` headers with `rel="next"` and `rel="prev"` where those pages exist, preserving every other query parameter. The `ETag` is the same for every page and parameter combination at a change set, which is correct because the URL carries the page and parameters and the content at a change set never changes, so it must not be derived from the content.
- `GET /openapi.json` returns an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document generated from Filby's metadata tables: the `/projections` and `/changelog` paths and one path per projection with its declared parameters, its paging parameters (`page`, and `pageSize` with the declared `page_size` as its default and `page_max` as its maximum) and a response schema derived from the root entity's fields, the nesting and the lookups, each lookup being its object schema or `null`, so a new projection is documented, and its clients generated and requests validated, without anyone writing a schema. The document changes whenever a projection is added, so it is served without cache headers. Its `info` comes from `FetchOptions.info` (`{ title, version, description? }`) and defaults to `{ title: 'Filby', version: '1.0.0' }`, and `basePath` becomes its single `servers` entry. Field types describe what node-pg emits in JSON rather than the Postgres type: `INTEGER` and `SMALLINT` are integers, `REAL` and `DOUBLE PRECISION` are numbers, `NUMERIC` and `BIGINT` are strings because node-pg returns them as strings, `DATE` and `TIMESTAMP` are `date-time` strings, `UUID` is a `uuid` string, an enum lists its values, an array is an array of its element type, `JSON`, `JSONB` and any other type are unconstrained, and a nullable field also allows `null`. A projection declared with `dependencies` has only `changeSetId`, `page` and `pageSize` and a response of unconstrained objects, because Filby does not know the shape of its function. The example application's Swagger UI renders this document.

Errors the handler does not expect, such as a lost database connection, are thrown for the host application to log and turn into a 500.

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

#### filby.withTransaction&lt;T&gt;(callback: (client: PoolClient) => Promise&lt;T&gt;): Promise&lt;T&gt;
Passes a [node-pg client](https://node-postgres.com/) to the given callback. The callback runs inside a database transaction, which is committed when the callback returns and rolled back if it throws. Use this to directly query the aggregate entity data for your projections. See [Aggregate](#aggregate) for the naming convention of the aggregate functions, e.g.

```js
async function getParks(changeSetId) {
  return filby.withTransaction(async (client) => {
    const { rows } = await client.query(`
      SELECT p.code, p.name, s.type AS season_type, s.start AS season_start, s.end AS season_end
      FROM get_park_v1_aggregate($1) p
      LEFT JOIN get_season_v1_aggregate($1) s ON s.park_code = p.code
      ORDER BY p.code ASC, s.start DESC, s.type ASC;
    `, [changeSetId]);
    return rows.map(toParkStructure);
  });
};
```

## Configuration
Filby requires Node.js 22.12 or later and PostgreSQL 15 or later, and is tested against PostgreSQL 16.

```js
{
  // All the database configuration is passed through to https://www.npmjs.com/package/pg
  "database": {
    "user": "fby_example",
    "database": "fby_example",
    "password": "fby_example"
  },

  // Specifies the paths to the migrations folders, relative to the working directory
  // Defaults to ["migrations"]
  "migrations": [
    "path/to/schema/migrations",
    "path/to/data/migrations"
  ],

  "notifications": {

    // The frequency Filby will check for new notifications
    // Defaults to 1 minute
    "interval": "5s",

    // The initial delay before Filby starts checking for notifications
    // (you still have to call filby.startNotifications)
    // Defaults to 10s
    "initialDelay": "1s",

    // THe maximum number of times Filby will attempt to deliver a hook
    // Defaults to 10
    "maxAttempts": 20,

    // The maximum amount of time Filby will wait before retrying a failed hook
    // Defaults to 1 hour
    "maxRescheduleDelay": "30s",

    // The maximum amount of time Filby will wait for a hook's handlers before aborting their signal and treating the attempt as failed
    // Defaults to 30 seconds
    "handlerTimeout": "10s",

    // Whether to hold a dedicated connection that listens for newly scheduled notifications and polls immediately, instead of waiting for the next interval
    // Defaults to false
    "listen": true
  }
}
```

Durations such as `30s`, `5m` and `1h` use [parse-duration](https://www.npmjs.com/package/parse-duration) syntax and are validated when Filby is constructed, so an unparseable duration fails with `Invalid config: /notifications/handlerTimeout must be a duration such as '30s'`.

Run the process that reads data with `TZ=UTC`. [node-pg](https://node-postgres.com/) converts `DATE` and `TIMESTAMP` values using the process time zone, so the same row renders differently on machines with different time zones. Filby never uses the process time zone for migrations, so this only affects the values your application reads.

### Using a schema
Filby references every object unqualified, so everything lands in the first schema on the connection's search path, which for a new role is `"$user", public`: the role's own schema if one exists, otherwise `public`. To use another schema, create it and grant the Filby role `USAGE` and `CREATE` on it, then point the search path at it, either on the role

```sql
ALTER ROLE filby SET search_path = reference_data;
```

or with the [pg](https://www.npmjs.com/package/pg) connection option in the config, which Filby passes to every connection it opens, including marv's

```js
"database": {
  "user": "filby",
  "options": "-c search_path=reference_data"
}
```

Filby's tables, marv's `migrations` table, entity tables, enums, generated functions and your own migration SQL then land in that schema with no other change. Extensions, types and functions that live in `public` must be qualified in projection SQL and entity field types, and connections Filby did not open, such as your application's own pool, must set the same search path or qualify names.

### Migration Directories
Filby scans every directory in the `migrations` list and applies the combined set of migrations with [marv](https://github.com/guidesmiths/marv) in a single run, so you can split a large set of migrations across several directories, for example one for schema and one for data.

Marv groups migrations by namespace. Filby's own migrations use the `filby` namespace and always run first. Your migrations use marv's `default` namespace unless their directory contains a `.marvrc` file declaring another. Within a namespace, marv applies migrations in level order regardless of which directory they came from, so directories sharing a namespace must share one numbering sequence.

```
schema/
  |- 001.define-park-schema.yaml
  |- 003.define-season-schema.yaml
data/
  |- 002.initial-park-data.yaml
  |- 004.initial-season-data.yaml
```

If two directories in the same namespace contain migrations with the same level, `filby.init()` fails with marv's duplicate level error, e.g. `Migration 1 from namespace: default is duplicated by 001.define-park-schema.yaml, 001.initial-park-data.yaml`.

Alternatively, give each directory its own numbering sequence by adding a `.marvrc` with a distinct namespace. For example, `schema/.marvrc` might contain

```json
{
  "namespace": "schema"
}
```

and `data/.marvrc`

```json
{
  "namespace": "data"
}
```

Namespaces run one after another in the order they first appear in the `migrations` list, so list a directory before any directory whose migrations depend on it.

Directives in a `.marvrc` apply only to the migrations in that directory. For example, the following makes marv re-run every migration in the directory on each `filby.init()`, so they must be idempotent.

```json
{
  "namespace": "views",
  "directives": {
    "audit": false
  }
}
```

Filby verifies the checksums of its own migrations on every `filby.init()`, and fails if one has changed since it was applied. Filby supports upgrading from version 0.14.0 or later; databases created by earlier versions will fail this check. The checksums of your own migrations are not verified.

## Command Line
Filby ships a command line tool for checking migrations without a database.

```bash
npx filby validate migrations
npx filby preview migrations
```

Both commands scan the directories you name, or `migrations` when you name none, exactly as `filby.init()` does. Every YAML and JSON migration is parsed, validated against Filby's schema and rendered to SQL, which reads the CSV files that `source` frames refer to, so a syntax error, a schema violation, a key that names no field, a reference that specifies its version twice, or a missing or malformed CSV file is reported. SQL migrations are not checked. Every file is checked, and each problem is written to stderr as `<file>: <message>`, with the JSON path of the offending value where there is one.

```
migrations/0004.season-2020.yaml: /0 must have required property 'effective'
```

`filby validate` exits with code 1 if any migration failed and 0 otherwise, so it can run in CI. `filby preview` performs the same checks and then writes the SQL that `filby.init()` would run to stdout, in the order it would be applied, each migration preceded by a `-- <file>` comment and SQL migrations copied verbatim, so you can read what a change set will do or diff it in review. If any migration fails, `filby preview` writes the errors, no SQL, and exits with code 1.

The command line tool only reports what can be known from the files. Checks that need a database, such as whether a change set refers to an entity that exists, still happen when `filby.init()` applies the migration.

## Example Applications
This repository includes a [TypeScript](https://github.com/acuminous/filby/tree/main/examples/typescript) example application based on a Caravan Park business. It is a [Hono](https://hono.dev/) application that mounts `filby.fetch` in one line to serve the change log, the projections and the generated OpenAPI document under `/api`, exposes `filby.getNotificationStatus()` at `/health`, and posts notifications to the webhooks listed in its config. Swagger UI is served at `/documentation` from the generated `/api/openapi.json`, so nobody writes a schema by hand. The eight projections are `Amenities`, `Beaches`, `Catalogue`, `Grades`, `Models`, `Parks (Detailed)`, `Parks (Minimal)` and `VAT Rates`, each served at `/api/projections/<name>/v1`.

### Installation
```bash
git clone git@github.com:acuminous/filby.git
cd filby
npm i
npm run docker
cd examples/typescript
npm i
npm start
```

Once successfully started you should see the following output.

```
Server is listening on port 3000
See http://localhost:3000/documentation
Use CTRL+C or kill -TERM 18964 to stop
```

The application serves Swagger UI at http://localhost:3000/documentation. The reference data is a holiday park business that sells static caravans: ten parks with their amenities, the beaches they reach and the routes to them, seasons, offers and the models they sell, a catalogue of manufacturers, models, accessories, prices and VAT rates, and the grades the business maps onto that catalogue. A grade is a set of required attributes, Platinum requiring the most and Saver nothing, and every model holds one grade each year. The catalogue is the manufacturers' data and the grades are the business's own, so `Catalogue` and `Models` carry no grades; a model's grade is found through `Grades`. Every data frame is loaded from a CSV file under `examples/migrations/csv/<change set>/`, one file per entity, so a change set's YAML is its description, its effective date and its sources, each with the action that applies to the whole file; only the two 2026 catalogue files that both add and delete rows carry an action column instead. The ten change sets are:

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
        "amenity_code": "AMUSEMENT_ARCADE",
        "amenity": {
          "name": "Amusement Arcade",
          "category": "Entertainment",
          "age_group": "All Ages",
          "charge": "Paid",
          "vat_code": "Family Attraction"
        }
      },
      {
        "amenity_code": "CRAZY_GOLF",
        "amenity": {
          "name": "Crazy Golf",
          "category": "Sport",
          "age_group": "All Ages",
          "charge": "Paid",
          "vat_code": "Family Attraction"
        }
      },
      {
        "amenity_code": "INDOOR_POOL",
        "amenity": {
          "name": "Indoor Pool",
          "category": "Pool",
          "age_group": "All Ages",
          "charge": "Free",
          "vat_code": "Family Attraction"
        }
      },
      ...
    ],
    "beach_routes": [
      {
        "beach_code": "SANDY_BAY",
        "name": "Along the beach road",
        "distance_metres": 1200,
        "accessibility": "Step Free",
        "beach": {
          "name": "Sandy Bay",
          "surfaces": "{Sandy,Rocky}"
        }
      },
      {
        "beach_code": "SANDY_BAY",
        "name": "Via the cliff path",
        "distance_metres": 400,
        "accessibility": "Steep Steps",
        "beach": {
          "name": "Sandy Bay",
          "surfaces": "{Sandy,Rocky}"
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
      {
        "grade_code": "Silver",
        "discount_percent": "5.00"
      },
      {
        "grade_code": "Bronze",
        "discount_percent": "7.50"
      },
      {
        "grade_code": "Saver",
        "discount_percent": "10.00"
      }
    ],
    "models": [
      {
        "model_code": "AMB"
      },
      {
        "model_code": "AVO"
      },
      {
        "model_code": "BEV"
      },
      {
        "model_code": "CAS"
      },
      {
        "model_code": "CLW"
      },
      {
        "model_code": "HEL"
      },
      {
        "model_code": "LOI"
      },
      {
        "model_code": "RIO"
      }
    ]
  }
]
```

Devon Cliffs has eight amenities; the listing above is cut to three. Each park amenity is a row of `Park Amenity`, and the `Amenity` lookup under it embeds the one `Amenity` record it refers to as an object with the name, category, age group, charge and VAT code. The amenity's code is left out of the object because it is the join field and already on the park amenity. The beach routes have the same shape: each route is a row of `Beach Route` with facts of its own, the distance and how accessible it is, and the `Beach` lookup embeds the beach it leads to. Devon Cliffs reaches Sandy Bay two ways, step free along the beach road or down the steep cliff path, so the same beach appears under both routes. `surfaces` is a Postgres array of an enum type, which node-pg serves as the string `{Sandy,Rocky}` rather than a JSON array. `Parks (Minimal)` is the same projection without the lookups, so its park amenities are codes alone and its routes carry the beach code alone, for a consumer that already holds `Amenities` and `Beaches`.

`code` is one of the projection's declared parameters; `name` matches the start of a name and `region` takes a list, as `?region=Scotland&region=Wales`. Both park projections page ten parks at a time, with the total in `X-Total-Count` and the neighbouring pages in `Link`. The season dates are facts about the park, whereas the effective date of change set 6 is when the park started saying so: it took effect on 1 March 2026, the first day of the 2026 season, and replaced each park's current and next season in one step. Haggerston Castle had not announced its 2027 season, so its `next_season_start` and `next_season_end` are null. The offers are by grade, which `Grades` describes: `GET http://localhost:3000/api/projections/Grades/v1?changeSetId=5&code=Gold` returns the attributes a Gold model must have and the models that held Gold each year.

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
    "lastModified": "2026-10-21T10:30:08.999Z",
    "entityTag": "6a8f467b146c4695a674"
  },
  {
    "id": 5,
    "effective": "2026-01-01T00:00:00.000Z",
    "description": "2026 catalogue and price list",
    "lastModified": "2026-10-21T10:30:09.015Z",
    "entityTag": "3e13cd64b7be4e29a14b"
  },
  {
    "id": 10,
    "effective": "2027-01-01T00:00:00.000Z",
    "description": "2027 catalogue and price list",
    "lastModified": "2026-10-21T10:30:09.030Z",
    "entityTag": "bddaac93c92a45b19983"
  }
]
```

Change set 2 was in force on 1 June 2025, so `Catalogue` at change set 2 is the whole range as it stood, each manufacturer with its models and each model with the prices and accessories it had then. It has no paging because a product range is read whole; `Models` is the same data one model at a time, with the parameters a search page needs.

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
          {
            "code": "VER-DEC",
            "name": "Decking",
            "price": "4195.00"
          },
          {
            "code": "VER-VER",
            "name": "Veranda",
            "price": "2595.00"
          }
        ]
      }
    ]
  }
]
```

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

`GET http://localhost:3000/api/projections/Parks%20(Minimal)/v1?changeSetId=6&code=RI` returns the park as Skegness with everything it had as Richmond, and `GET http://localhost:3000/api/projections/Parks%20(Minimal)/v1?changeSetId=8&code=GA` returns an empty list, while both parks are still there at any earlier change set.
