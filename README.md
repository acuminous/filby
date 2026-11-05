[![NPM version](https://img.shields.io/npm/v/filby.svg?style=flat-square)](https://www.npmjs.com/package/filby)
[![Node.js CI](https://github.com/acuminous/filby/workflows/Node.js%20CI/badge.svg)](https://github.com/acuminous/filby/actions?query=workflow%3A%22Node.js+CI%22)
[![Codecov](https://codecov.io/gh/acuminous/filby/graph/badge.svg)](https://codecov.io/gh/acuminous/filby)

# Filby - A framework for managing reference data that changes over time

*There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.*
<p align="right">-<a href="https://www.amazon.co.uk/Time-Machine-H-G-Wells/dp/1614271976">The Time Machine - H. G. Wells</a></p>

## Contents

- [Introduction](#introduction)
- [User interfaces](#user-interfaces)
- [Benefits](#benefits)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Guide](#guide)
- [Upgrading from 0.14.0 to 1.0.0](#upgrading-from-0140-to-100)
- [Reference](#reference)
- [Example application](#example-application)

## Introduction

Filby is a framework for managing reference data that changes over time, such as product catalogues, price lists, tax rates and calendars. Like a time series database, it stores successive values over time and lets applications query them by date. However, rather than storing high volumes of measurements such as sensor readings, Filby focuses on data that changes infrequently. Each change takes effect on a specified date and can be scheduled in advance. Previous values are retained after they are replaced, so an application can read the data as it stood, stands or will stand at any point in time, past, present or future.

Two typical uses are:

- **A developer-first product information management (PIM) system.** Product catalogues and price lists are kept in your repository, published on a date and served to every channel. A hook sends each change to a CMS as soon as it is loaded into Filby, and schedules it for publication on its effective date.
- **External reference data.** Data is decided and published by someone outside the organisation, such as tax rates, regulatory limits, bank holidays or a supplier's price list. It is often published only as a web page, a PDF or an announcement, with no feed to subscribe to. Load each change when it is announced, with the date it takes effect. Applications can then retrieve the values that apply on any given date.

In both cases, you describe your data and how it is served in migration files, using a small domain-specific language (DSL). The example below walks through this process step by step, using YAML migrations and data imported from CSV.

**Step 1. Define an entity and a projection**

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
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

**Step 2. Load CSV data with an effective date**

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
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

**Step 3. Serve the data over HTTP**

```js
const filby = new Filby({ database: { user: 'filby', database: 'filby' } });
await filby.init();
app.all('/api/*', (c) => filby.fetch(c.req.raw, { basePath: '/api' }));
```

The example above uses [Hono](https://hono.dev/). `filby.fetch` takes a web standard Request and returns a Response, so it works with most popular HTTP servers. Express needs a short adapter; see [Serving over HTTP](#serving-over-http).

**Step 4. Read the change log and query the data at a chosen change set**

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

If you omit the change set id, Filby redirects the request to the change set currently in force.

You can load next year's rates today with an effective date of 1 January. Filby assigns a change set id immediately, so clients can fetch the rates before they take effect. Data a client has already retrieved remains unchanged.

The [example application](#example-application) uses Filby to manage data for a holiday park business. It includes parks, beaches, amenities, a caravan catalogue, prices and VAT rates, loaded from CSV through ten change sets. Its [example queries](#example-queries) show how to retrieve everything from a park's current product range to next year's price list.

## User interfaces

Filby has a sister project, [Filby UI](https://github.com/acuminous/filby-ui), which provides a read-only web interface to any application that serves Filby's API. You can list projections, inspect their change logs, see which change set is in force at a given date, and browse documents with their nests and lookups displayed as tables. One command starts it against a running application:

```bash
FILBY_API_HOST=localhost FILBY_API_PORT=3000 npx github:acuminous/filby-ui
```

Filby UI is read-only. This may sound like a significant limitation, but it is a deliberate design choice. Supporting edits would require authentication, authorisation, review and promotion workflows. Your existing source control management (SCM) system and deployment tooling can provide these capabilities without Filby having to implement and maintain them.

Schema design also requires more modelling expertise than may initially be apparent. Consider the beaches in the holiday park example application. Suppose marketing asks for each park's distance to the beach. That sounds like a single field, but a park might have a short route down steep steps and a longer, step-free route. Each route has its own distance and accessibility. Capturing this accurately means modelling beach routes, rather than adding a "distance to beach" field.

Software engineers are well placed to make these modelling decisions. Defining the model in migration files lets them use familiar source control tools to review and release changes to both the model and its data.

## Benefits

Most systems depend on reference data: rates, codes, catalogues, calendars and other slow-moving facts. These values get copied into caches, client bundles, application databases and data lakes. The copies may be correct when they are made, but they can go stale.

When values change, the old ones may still be needed. Analytics needs historical data, and a transaction that started before a change may need the original values until it finishes. Future changes need to be prepared and checked before they take effect, sometimes at midnight across several systems. The shape of the data also evolves, and clients need time to adapt.

Filby groups related changes, such as a new price list, and gives each group an effective date and an id. Applications can request the data that applies on a particular date, or use an id to keep requesting exactly the same version. Loading new changes does not alter the data returned by existing ids.

This provides several benefits:

- **Consistency.** Clients can check for updates, receive change notifications or fetch future data before it takes effect. A transaction can keep using the same id throughout, even when newer data becomes current.
- **Performance.** Data requested using a particular id never changes, so Filby sends caching headers that allow responses to be cached indefinitely. Larger data sets can be exported and bundled with an application, or held locally and refreshed when updates are available.
- **History.** Earlier versions of the data remain available. A report can be re-run using the same id it originally used, and a price from 2025 can still be looked up in 2027.
- **Timing.** Future changes can be loaded, checked and cached in advance. Filby makes them current automatically at the specified time and sends a notification, without requiring a deployment at that moment.
- **Schema versioning.** When the shape of the data changes, the new shape can be published alongside the old one. Each client moves across when it is ready.
- **Right-sized responses.** You define views of the data for different clients. A product list page can request a summary, while a product details page requests the full details. These views are defined on the server, where their structure and cost can be reviewed.
- **Local testing.** The files that define and populate the data live in your repository, so developers can load the same data into a local Postgres database. A test can request a particular id and receive the same data every run.

Changes can also be inserted earlier in the timeline, for example to correct or backfill data, without altering the data returned by existing ids. See [Correcting and re-issuing data](#correcting-and-re-issuing-data).

## How it works

The best way to understand Filby is to think of it as source control for reference data. In git, a commit bundles related changes to source code, and the commit log gives it a hash. In Filby, a change set bundles related changes to reference data, and the change log gives it an id. An application requests for the data at a change set id, much as you would check out a commit, and gets the same data every time.

Reference data is added as change sets in CSV, YAML, JSON or SQL migration files. Filby applies them to a PostgreSQL database, and your application mounts Filby's HTTP handler. A client reads a projection's change log, picks a change set and asks for the data at it, and a webhook or any other handler hears when something changes.

<pre>
                         Change
                      Notification                           Webhook
                      ┌─────────┐   ┌─────────────────────────────────────────────────────┐
                      │         │   │                                                     │
                      │         ▼   │                                                     ▼
┌────────┐      ┌───────────┬──────────┐ GET /api/changelog?projection=$p&version=$v ┌──────────┐
│        │      │           │          │◀────────────────────────────────────────────│          │
│        │      │           │ Example  │                                             │          │
│   DB   │◀────▶│   Filby   │   App    │                                             │  Client  │
│        │      │           │          │ GET /api/projections/$p/v$v?changeSetId=$c  │          │
│        │      │           │          │◀────────────────────────────────────────────│          │
└────────┘      └───────────┴──────────┘                                             └──────────┘
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

Inside Filby, the pieces relate like this.

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
        ╱│╲                                   │
┌─────────────────┐                  ┌─────────────────┐
│                 │                  │                 │
│                 │╲ is grouped by   │                 │
│   Data Frame    │──────────────────│   Change Set    │
│                 │╱                 │                 │
│                 │                  │                 │
└─────────────────┘                  └─────────────────┘
</pre>

An **entity** is a type of reference data: a park, a VAT rate, a caravan model. It is declared with a name, a version, the key fields that determine a unique record, the regular data fields, and optionally some checks, which become PostgreSQL check constraints. A field may be of any PostgreSQL type, including an enum declared in the same DSL. An entity is never altered in place; a change to its shape is a new version alongside the old one.

A **data frame** is a record of an entity as it was at a specific point in time: a `SET` frame carries the record's values, a `DELETE` frame says the record is gone. Frames are only ever added, so the history of a record is the sequence of its frames.

A **change set** groups data frames, for one entity or many, under one effective date, which is the date from which its frames are in force.

An **aggregate** is the collapsed state of an entity at a change set, built from the frames, with deleted records omitted. Filby creates an aggregate function for every entity version, and everything else reads through it.

A **projection** is a versioned view over one or more aggregates, and the unit a client consumes. Most are declared by naming a root entity, with optional parameters, ordering and paging; related entities can be nested under the root, and the fields each level carries can be chosen. A projection the DSL cannot express maybe written as a SQL function. Either way Filby knows which entities the projection depends on, so it can notify clients when the data behind the projection changes.

A **hook** names an event your application wants to hear about: a projection added or dropped, a change set added or change set taking effect. A **notification** is raised for a hook whenever its event happens, and delivered to the handler your application registered, with retries, so downstream copies of the data can stay current without polling.

## Getting started

Filby needs Node.js 22.12 or later and PostgreSQL 15 or later, and is tested against PostgreSQL 16.

```bash
npm install filby
```

Construct Filby with the database connection details and the directory holding your migrations, and call `init()` once at startup. `init()` connects and applies the migrations that have not yet been applied.

```js
const { Filby } = require('filby');

const filby = new Filby({
  database: { user: 'filby', database: 'filby', password: 'filby' },
  migrations: ['migrations'],
});

await filby.init();
```

A migration is a YAML, JSON or SQL file named `<level>.<description>.<extension>`, such as `0001.define-schema.yaml`, applied once, in level order. Start with a file that declares entities and projections, as in the [Introduction](#introduction), and add a file per change set after it. `npx filby validate migrations` checks the files without a database; see [Command line](#command-line). The [Configuration](#configuration) reference lists every option and its default.

Once `init()` has resolved, mount `filby.fetch` to serve the data over HTTP, or call `getDocuments` and the other methods under [API](#api) directly. Subscribe to any hooks, then call `filby.startNotifications()`, and call `filby.stop()` on shutdown.

```js
const { Filby } = require('filby');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const filby = new Filby({
  database: { user: 'filby', database: 'refdata', password: 'secret' },
  migrations: ['migrations'],
});

const app = new Hono();
app.all('/api/*', (c) => filby.fetch(c.req.raw, { basePath: '/api' }));

filby.subscribe('webhook/vat-rates', async (notification, { signal }) => {
  await fetch('https://example.com/hooks/vat-rates', { method: 'POST', body: JSON.stringify(notification), signal });
});

await filby.init();
await filby.startNotifications();
const server = serve({ fetch: app.fetch, port: 3000 });

process.on('SIGTERM', async () => {
  server.close();
  await filby.stop();
});
```

## Guide

#### ADD_ENTITY

An entity describes a type of record, such as a park or a price. Declare one with `ADD_ENTITY`, specifying:

- `name`: the entity's name.
- `fields`: the field names and their types.
- `key`: one or more fields that identify a record. When there are multiple key fields, their combined values identify the record.

You can also provide a `version`, a `description` and named validation `checks`. The version defaults to 1.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0001.define-schema.yaml
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
```

Fields use PostgreSQL types, including `TEXT`, `DATE`, `NUMERIC(5,2)`, `TIMESTAMP WITH TIME ZONE` and arrays such as `TEXT[]`. A field can use the shorthand form `Code: TEXT`, or specify its type and other properties explicitly, as shown for `Name`.

Key fields cannot be null. Other fields are nullable by default. For non-key fields, `nullable: false` describes the field as required for tooling such as generated OpenAPI documentation; it does not by itself enforce non-null values.

Checks are SQL expressions that validate field values. Keep the surrounding parentheses and use canonical field names: lowercase with spaces replaced by underscores. The example checks that `code` contains exactly two characters. Checks only apply to `SET` frames. A `DELETE` frame contains just the key of the record being removed, so its other fields are empty and are not checked.

Entity and field names can use Title Case with spaces. Filby canonicalises these names, so a field declared as `Park Code` appears as `park_code` in served documents. See [Names](#names).

An entity's definition is never altered in place. To change its shape, declare a new version. See [Evolving the schema](#evolving-the-schema).

#### ADD_ENUM

An enum defines a set of permitted values for a field. Declare it with `ADD_ENUM`, providing a `name` and a list of `values`. Declare the enum before an entity that uses it, then use its declared name as the field type.

```yaml
- operation: ADD_ENUM
  name: Customer Type
  values:
    - Guest
    - Owner

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

Here, each park season is identified by the combination of `Park Code` and `Customer Type`. The customer type must be either `Guest` or `Owner`.

Enum values retain their spelling and case, and their listed order determines their sort order. Values outside the declared list are rejected.

An enum can also be used as an array type by adding `[]` to its declared name, for example `Customer Type[]`.

To add values to an existing enum, use `ALTER_ENUM`. See [Evolving the schema](#evolving-the-schema).

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

YAML gets long, so a frame may take its rows from a CSV file instead, with `source`, a path relative to the migration file. The CSV needs a header row of the entity's field names. Put the action on the frame to apply it to every row, in which case the file must not have an `action` column, or leave it off the frame and give the file an `action` column with every cell filled. A file whose name ends in `.tsv`, in any case, is read as tab-separated.

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

The effective date may be a calendar date, such as `2024-10-01`, or a timestamp with an explicit offset, such as `2024-10-01T00:00:00Z`. A calendar date is midnight in the change set's `timezone`, an IANA name, so the stored instant follows daylight saving time. A calendar date without a `timezone` is rejected, because Filby never uses the process time zone: the same file would otherwise render differently on different machines. A timestamp with an offset is stored as written, with or without a `timezone`. The effective date may be in the future, which is how data is released ahead of time; see [Why Filby](#why-filby).

A field with no value, and an empty CSV cell, is stored as `NULL`. A nested map or list in YAML or JSON is stored as JSON, so it can be loaded into a `JSON` or `JSONB` column. Every other value, whether inline or in a CSV cell, is passed to Postgres as written and cast to the column type. Filby does not convert values that look like numbers, so `007` keeps its leading zeros in a `TEXT` column, `1.50` keeps its scale in a `NUMERIC` column and `9007199254740993` keeps every digit in a `BIGINT` column. A migration is all or nothing: if Postgres rejects any value, for any reason from a bad cast to a check violation, nothing from the migration is applied. A change set may hold only one frame per key for each entity.

### Projections

A projection defines the view of the data a consumer reads. It can select fields, combine related entities, and control filtering, sorting and paging. The simplest projection names a root entity and returns one document per record of that entity at the requested change set.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0004.define-projections.yaml
- operation: ADD_PROJECTION
  name: Parks
  description: Parks alone, for a list or a picker
  root: Park@1
```

`Park@1` selects version 1 of the `Park` entity. By default, documents contain all of the entity's fields and are sorted by its key.

```json
[
  { "code": "DC", "name": "Devon Cliffs", "region": "South West" },
  { "code": "PV", "name": "Primrose Valley", "region": "Yorkshire" }
]
```

##### Filtering, sorting and paging

Three optional properties control how records are selected and returned:

- `parameters` defines the filters consumers can supply.
- `order` defines the sort order.
- `paging` defines the default and maximum page sizes.

```yaml
- operation: ADD_PROJECTION
  name: Parks
  description: Parks alone, for a list or a picker
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
  paging:
    page_size: 10
    page_max: 50
```

Each parameter names a field and a matching rule. The field usually belongs to the root entity, but it can also belong to a nested or looked-up entity, as described in [Filtering by nested fields](#filtering-by-nested-fields).

| Match | Behaviour |
| ----- | --------- |
| `equals` | Matches the supplied value exactly. This is the default. |
| `prefix` | Matches values beginning with the supplied text. |
| `in` | Matches any of the supplied values. On an array field, matches arrays that share at least one value with the supplied values. |
| `contains` | Matches arrays that include the supplied value. Applies only to an array field. |
| `range` | Matches values between optional, inclusive lower and upper bounds. |
| `gt` | Matches values greater than the supplied value. |
| `gte` | Matches values greater than or equal to the supplied value. |
| `lt` | Matches values less than the supplied value. |
| `lte` | Matches values less than or equal to the supplied value. |

An array field accepts only `in` and `contains`. An empty or null array never matches.

The parameter names `change_set_id`, `page_offset` and `page_size` are reserved.

`order` lists the fields to sort by. Each is ascending by default, or can use `DESC` for descending order. `nulls` can specify `FIRST` or `LAST`. Records with equal sort values are ordered by the entity's key. When no order is declared, the key determines the entire order.

`paging.page_size` sets the default page size, and `paging.page_max` sets the maximum. Without `paging`, all matching records are returned.

See [Serving projections over HTTP](#serving-projections-over-http) for the corresponding query parameters and response headers.

##### Nests

A nest embeds related records under each parent document as a list. It specifies:

- `entity`: the child entity and version.
- `on`: a map from fields on the child to fields on the parent.
- `order`: an optional sort order, which defaults to the child's key.

```yaml
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  description: Parks with their seasons
  root: Park@1
  nest:
    Seasons:
      entity: Park Season@1
      on:
        Park Code: Code
      order:
        - field: Customer Type
```

Each park contains its matching seasons. By default, the child's join fields are omitted because their values are already present on the parent.

```json
[
  {
    "code": "DC",
    "name": "Devon Cliffs",
    "region": "South West",
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
    ]
  }
]
```

A park with no seasons has an empty `seasons` list.

Nests can contain further nests to any depth. Each level joins to its immediate parent. Here, each manufacturer contains its models, and each model contains its prices:

```yaml
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
        "prices": [
          { "year": 2025, "list_price": "15995.00" },
          { "year": 2026, "list_price": "16450.00" }
        ]
      }
    ]
  }
]
```

##### Lookups

A lookup embeds a single related record as an object.

For example, parks and amenities have a many-to-many relationship. A `Park Amenity` entity links them using a park code and an amenity code. Nesting these links under a park produces a list of amenity codes:

```yaml
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  root: Park@1
  nest:
    Amenities:
      entity: Park Amenity@1
      on:
        Park Code: Code
```

An individual park document looks like this:

```json
{
  "code": "DC",
  "name": "Devon Cliffs",
  "amenities": [
    { "amenity_code": "INDOOR_POOL" },
    { "amenity_code": "SHOWBAR" }
  ]
}
```

Add a lookup to include the amenity each link refers to:

```yaml
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  root: Park@1
  nest:
    Amenities:
      entity: Park Amenity@1
      on:
        Park Code: Code
      lookup:
        Amenity:
          entity: Amenity@1
          on:
            Code: Amenity Code
```

The lookup's `on` map relates fields on the looked-up entity to fields on the current record. Here, the amenity's `Code` matches the link's `Amenity Code`.

```json
{
  "code": "DC",
  "name": "Devon Cliffs",
  "amenities": [
    {
      "amenity_code": "INDOOR_POOL",
      "amenity": {
        "name": "Indoor Pool",
        "category": "Pool",
        "charge": "Free"
      }
    }
  ]
}
```

A lookup must join on every key field of the entity it looks up. This ensures that it finds at most one record. If no matching record exists at the requested change set, the lookup returns `null`.

Lookups can appear on the root or under any nest. They have no sort order and cannot contain further nests or lookups. If the related entity needs children of its own, use a nest instead.

##### Filtering by nested fields

A parameter can also select root records by the values of the records nested or looked up beneath them. Give the parameter's `field` as a path of names separated by dots. The path lists the nests and lookups to follow, using the names the projection declares, and ends with a field of the last entity. Here, `beach_surface` follows each park's `Beach Routes` nest to its `Beach` lookup and tests the beach's `Surfaces`:

```yaml
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  root: Park@1
  parameters:
    beach_surface:
      field: Beach Routes.Beach.Surfaces
      match: contains
    route_access:
      field: Beach Routes.Accessibility
  nest:
    Beach Routes:
      entity: Beach Route@1
      on:
        Park Code: Code
      lookup:
        Beach:
          entity: Beach@1
          on:
            Code: Beach Code
```

`?beach_surface=Sandy` returns the parks with at least one route to a sandy beach. The filter selects which parks are returned without changing their contents, so each park still includes all of its routes, including routes to beaches that are not sandy. When the parameter is supplied, parks with no beach routes are excluded.

Each parameter is tested against one nested record at a time, so a `range` parameter matches only when a single route falls within both bounds. Different parameters are tested independently. `?beach_surface=Sandy&route_access=Step%20Free` returns the parks that have a route to a sandy beach and a step-free route, even when they are different routes.

Any match type can be used at the end of a path, including `contains` and `in` on an array field. A lookup cannot contain nests or lookups, so it can only be the last name before the field. The field does not need to appear in the documents. Consumers see only the parameter's name, and the OpenAPI document describes the parameter using the type of the field at the end of the path.

##### Selecting fields

Use `fields` to choose which fields appear in a document and their order. It can be specified on the root, a nest or a lookup.

Without `fields`, a document includes every field of its entity, except fields used to join it to its parent. With `fields`, it includes exactly the listed fields. A join field is included only if explicitly listed.

A nest may use `fields: []` to omit all of its own fields while retaining its nests or lookups. The root and a lookup must select at least one field.

Here, each park amenity link contributes only its `amenity` lookup:

```yaml
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

```json
{
  "code": "DC",
  "name": "Devon Cliffs",
  "amenities": [
    {
      "amenity": {
        "code": "INDOOR_POOL",
        "name": "Indoor Pool",
        "charge": "Free"
      }
    }
  ]
}
```

Parameters and sorting can still use fields that are omitted from the output.

An entry in `fields` can also be a map with `field` and `as`. It carries the field under the name given by `as`. The alias belongs to this projection only. The entity, its data and its CSV files keep the original name. A field may be listed more than once to carry it under several names:

```yaml
- operation: ADD_PROJECTION
  name: Parks (Detailed)
  version: 2
  root: Park@1
  fields:
    - Code
    - field: Code
      as: Park Code
    - Name
```

```json
{
  "code": "DC",
  "park_code": "DC",
  "name": "Devon Cliffs"
}
```

Parameters, `order` and `on` still use the entity's field names, not the aliases. Each property of a document must have a different name. An alias must not repeat another property or a nest or lookup name at the same level. It must not begin with `fby_`. At the root, it must not take the name of a field that a nest or lookup joins on.

##### Names and dependencies

A nest or lookup name must not duplicate a field of its parent entity, or another nest or lookup name at the same level. Names beginning with `fby_` are reserved for Filby. A name cannot contain a dot, because dots separate the names in a parameter's path.

The root, nested and looked-up entities are all dependencies of the projection. A change set affecting any of them appears in the projection's change log and notifies its hooks.

##### Custom SQL

For a shape the DSL cannot express, declare the projection's `dependencies` instead of a `root`, then implement its query function in a SQL migration.

Name the function `get_<projection>_v<version>` and give it a change set id parameter. Filby uses the declared dependencies to track relevant change sets, and `filby.fetch` serves the projection by calling the function.

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

This function reads models, prices and VAT rates at the same change set, keeping their values consistent:

```sql
-- migrations/0008.create-get-price-list-v1-function.sql
CREATE FUNCTION get_price_list_v1(p_change_set_id INTEGER)
RETURNS TABLE (
  code TEXT,
  name TEXT,
  year INTEGER,
  list_price NUMERIC(10,2),
  vat_code vat_code,
  vat_rate NUMERIC(5,2)
)
AS $$
  SELECT
    m.code,
    m.name,
    p.year,
    p.list_price,
    m.vat_code,
    r.rate AS vat_rate
  FROM get_model_v1_aggregate(p_change_set_id) m
  INNER JOIN get_price_v1_aggregate(p_change_set_id) p
    ON p.model_code = m.code
  INNER JOIN get_vat_rate_v1_aggregate(p_change_set_id) r
    ON r.code = m.vat_code
  ORDER BY m.manufacturer_code, m.name, p.year
$$ LANGUAGE sql STABLE;
```

`parameters`, `order`, `paging`, `fields`, `nest` and `lookup` require a root entity and cannot be combined with `dependencies`.

#### Serving projections over HTTP

When a projection is served through `filby.fetch`, consumers supply filters and paging controls as query parameters. The projection's configuration determines which filters are available, how results are sorted and whether they are paged.

##### Filtering

The parameter names declared in the projection become HTTP query parameter names. For the `Parks` example above:

| Query string | Result |
| ------------ | ------ |
| `?code=DC` | Parks whose code is `DC`. |
| `?name=Dev` | Parks whose name begins with `Dev`. |
| `?region=Scotland&region=Wales` | Parks in either Scotland or Wales. |

For an `in` match, repeat the parameter for each permitted value.

A parameter configured with `range` uses `_from` and `_to` suffixes. For example, a numeric range parameter named `berths` accepts `?berths_from=4&berths_to=6`. Either bound can be omitted, and both bounds are inclusive.

The comparison modes `gt`, `gte`, `lt` and `lte` use the parameter name directly. For example, `?berths=4` means “greater than 4” when the parameter is configured with `gt`, or “at least 4” when configured with `gte`.

##### Paging

For a projection with `paging` configured, consumers use:

| Query parameter | Purpose |
| --------------- | ------- |
| `page` | Selects the page to return. |
| `pageSize` | Requests a page size, subject to the configured maximum. |

For example, `?page=2&pageSize=20` requests page 2 with 20 root records per page.

The HTTP names `page` and `pageSize` are separate from the YAML configuration properties `page_size` and `page_max`.

Pages count root records. A page of ten parks includes all of their nested seasons; those seasons do not count towards the page size.

The response includes:

| Header | Contents |
| ------ | -------- |
| `X-Total-Count` | The total number of matching root records. |
| `Link` | Links to the next and previous pages, where available. |

Without `paging` configured, the projection returns all matching records.

### Hooks and notifications

Use hooks to run application code when projections are added or removed, new data is loaded, or a different change set becomes current.

#### Defining hooks

Declare a hook with `ADD_HOOK`, giving it a name and one of these events:

| Event | When it fires |
| ----- | ------------- |
| `ADD_PROJECTION` | A projection is added. |
| `DROP_PROJECTION` | A projection is dropped. |
| `ADD_CHANGE_SET` | A change set affecting a projection is added, regardless of its effective date. |
| `COMMENCE_CHANGE_SET` | A projection's current change set changes. |

For `ADD_CHANGE_SET` and `COMMENCE_CHANGE_SET`, set `projection` to restrict the hook to one projection, or omit it to receive notifications for every projection. `ADD_PROJECTION` and `DROP_PROJECTION` hooks always cover all projections.

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

#### Handling notifications

Register an asynchronous handler with `filby.subscribe`, using the hook's name exactly as declared. Subscribe before calling `startNotifications`. The following publishes a notification to SNS whenever the current change set for `Parks@1` changes:

```js
filby.subscribe(
  'sns/commence-change-set/parks-v1',
  async (notification, { signal }) => {
    await publishToSns(notification, { signal });
  }
);

await filby.startNotifications();
```

Give handlers separate hooks if they need independent retries. When multiple handlers subscribe to the same hook, a failure in one causes the retry to invoke all of them, including those that already succeeded. If your handler needs change set details, call `getChangeLog` or `getCurrentChangeSet` to retrieve them.

#### Delivery and retries

Filby polls for due notifications at `notifications.interval`, starting after `notifications.initialDelay`. You can run several application instances: Filby coordinates delivery through the database so that each notification is claimed by one instance per attempt.

If a handler throws or times out, Filby retries the notification. The retry delay starts at two seconds and doubles up to `notifications.maxRescheduleDelay`. Attempts stop when `notifications.maxAttempts` is reached. A hook with no subscriber also fails and is retried. If you see an error such as `No subscribers for hook 'sns/commence-change-set/parks-v1'`, check that the name passed to `filby.subscribe` matches the declared hook name.

Make handlers idempotent. Delivery is at least once, so a handler may receive the same notification again, for example if it completes just before its process is killed and success has not yet been recorded.

#### Timeouts and shutdown

The handler's second argument contains an [AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal). Filby aborts it when:

- The handler exceeds `notifications.handlerTimeout`.
- Your application calls `filby.stopNotifications()` or `filby.stop()`.

When a handler times out, Filby marks the attempt as failed and signals the handler to stop. If your handler ignores the signal, it may still be running when Filby retries the notification, causing both attempts to do the same work.

#### Monitoring failures

Subscribe to these events to monitor notification failures:

| Event | When it fires |
| ----- | ------------- |
| `Filby.NOTIFICATION_ERROR` | After a failed delivery attempt is recorded, or when polling or a database connection fails. |
| `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED` | After the final permitted delivery attempt fails. |

For delivery failures, the payload contains `error` and `notification`. The final failed attempt emits both events.

```js
filby.subscribe(
  Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED,
  ({ error, notification }) => {
    console.error('Hook attempts exhausted', notification, error.stack);
  }
);
```

Polling and connection errors have an `error` but no `notification`. A failed poll is followed by another attempt at the next polling interval.

```js
filby.subscribe(
  Filby.NOTIFICATION_ERROR,
  ({ error, notification }) => {
    const message = notification
      ? 'Notification delivery failed'
      : 'Notification polling or connection failed';

    console.error(message, notification, error.stack);
  }
);
```

These monitoring events are emitted synchronously. Catch errors inside their listeners; errors thrown by a listener are discarded. Handler errors may contain secrets, so sanitise them before logging where necessary.

#### Health checks

Use `filby.getNotificationStatus()` to check whether polling has started, when the last successful poll occurred, how many failures have occurred since then, and how many notifications are pending, overdue or exhausted. The returned fields are described under [API](#api).

Investigate a growing overdue count even when polling is succeeding. Successful polling does not guarantee successful delivery.

```js
app.get('/health', async (c) => {
  try {
    const status = await filby.getNotificationStatus();
    const healthy = status.started && status.failuresSinceLastSuccess === 0;
    return c.json(status, healthy ? 200 : 503);
  } catch {
    return c.json({ error: 'Notification status unavailable' }, 503);
  }
});
```

#### Migrations

Filby coordinates migrations and notification delivery across application instances. No new delivery starts while migrations are running, and migrations wait for deliveries already in progress, up to the handler timeout.

Keep `notifications.handlerTimeout` short enough that a slow handler does not delay migrations excessively.

#### Reducing notification latency

Set `notifications.listen` to wake the notification poller when a notification is scheduled. Regular polling remains the safety net because database notifications sent while the listening connection is unavailable are lost. If the listening connection drops, Filby emits `Filby.NOTIFICATION_ERROR` and reconnects with an exponential backoff from one second up to a minute.

### Correcting and re-issuing data

The aggregates for a change set include the frames from every change set with a lower or equal id and an earlier or equal effective date. This only works while change set ids follow effective dates, which pre-releasing or backfilling data would break. Filby keeps them in order by re-issuing change sets.

When you add a change set, Filby re-issues every live change set with a later effective date. A re-issued change set has a new id, the same description, effective date and data frames as the original, and `reissuedFrom` set to the original's id. The original is superseded: `getChangeLog` and `getCurrentChangeSet` no longer return it, but `getChangeSet` and `getAggregates` still do, with their original results, so anything cached by its id stays correct. A re-issued change set schedules `ADD_CHANGE_SET` and `COMMENCE_CHANGE_SET` notifications like any other.

Adding a change set with the same effective date as an existing one re-issues nothing. The new change set wins because it has the higher id, which is how data is corrected: add a change set with the same effective date and the corrected frames. The correction overrides the original from that date onwards, clients following the current change set see it at once, and the data at the original change set id is unchanged for anyone who cached it. Any pre-released change set with a later effective date is re-issued as usual.

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

The DSL has no operation for dropping change sets or data frames, because they are meant to be immutable, but is possibly via a SQL migration. The aggregates of every later change set change, so anything cached by id is wrong afterwards. The delete cascades to the change set's data frames and to their rows in the entity tables, so delete the change set rather than its frames.

```sql
-- migrations/0011.delete-a-change-set.sql
START TRANSACTION;

DELETE FROM fby_change_set
 WHERE id = 4;

END TRANSACTION;
```

### Evolving the schema

To change an entity's structure, create a new version alongside the existing one. Publish a new projection version to expose it, so existing clients can continue using the old version until they are ready to move.

To rename a field without a new entity version, publish a new projection version that carries the field under an alias. See [Selecting fields](#selecting-fields).

References to entities and projections must include a version, such as `Park@2`. The `version` property defaults to 1 when declaring an entity with `ADD_ENTITY` or a projection with `ADD_PROJECTION`, but references never default. This keeps each reference explicit as new versions are introduced.

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

#### Adding enum values

Use `ALTER_ENUM` to add values to an existing enum. New values are appended after the existing ones, in the order listed. You cannot add a value that already exists.

```yaml
# yaml-language-server: $schema=https://acuminous.github.io/filby/lib/schema.json
# migrations/0013.customer-type-staff.yaml
- operation: ALTER_ENUM
  name: Customer Type
  add:
    - Staff
```

Put any change set that uses a new enum value in a later migration file. Postgres cannot use the value within the transaction that adds it.

#### Removing unused definitions

Use the corresponding `DROP_*` operation when a definition is no longer needed:

- `DROP_HOOK` removes a hook and its notifications.
- `DROP_PROJECTION` removes a projection version, any hooks scoped to it and its notifications. It also raises notifications for hooks subscribed to `DROP_PROJECTION`.
- `DROP_ENTITY` removes an entity version. You cannot remove it while a projection depends on it or a change set contains data for it.
- `DROP_ENUM` removes an enum and its values. You cannot remove it while a field uses it.

Each operation requires the object to exist. The following example shows the syntax; entity and enum removal will fail if their dependencies have not been removed.

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

### Serving over HTTP

Use `filby.fetch(request, options)` to serve projections, change logs and API documentation over HTTP. It accepts a standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) and returns a standard [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response), with no dependency on a particular web framework.

#### Routes

All routes are relative to `options.basePath`, which defaults to an empty string.

| Method | Route | Returns |
| ------ | ----- | ------- |
| `GET` | `/projections` | A list of projections as `{ name, version, description }`, sorted by name and version. |
| `GET` | `/changelog?projection=<name>&version=<n>` | A projection's change log, as returned by `getChangeLog`. Accepts an optional `since=<id>`. |
| `GET` | `/projections/<name>/v<n>?changeSetId=<id>` | The projection's documents at the specified change set, as a JSON array. |
| `GET` | `/openapi.json` | The generated OpenAPI document. |

URL-encode projection names in paths. For example, `VAT Rates` becomes `/projections/VAT%20Rates/v1`.

If you omit `changeSetId`, Filby returns a `307` redirect to the current change set, preserving the other query parameters. For example, `/projections/Parks/v1?code=DC` might redirect to `/projections/Parks/v1?code=DC&changeSetId=8`.

#### Filtering and paging

Pass a projection's declared parameters in the query string:

- For a single value, use the parameter name: `?code=DC`.
- For an `in` match, repeat the parameter: `?region=Scotland&region=Wales`.
- For a `range` match, append `_from` and `_to` to the parameter name: `?berths_from=4&berths_to=6`. Either bound can be omitted.

For projections with paging configured, use `page` and `pageSize`. Page numbers start at 1. `pageSize` defaults to the projection's declared `page_size`; values above `page_max` are reduced to that maximum.

#### Caching and response headers

Data requested at a specific change set id never changes. Projection responses include:

| Header | Purpose |
| ------ | ------- |
| `Cache-Control: max-age=31536000, immutable` | Allows the response to remain fresh in a cache for one year without revalidation. |
| `ETag` | Identifies the response using the change set. |
| `Last-Modified` | Provides the modification date from the change set. |
| `X-Total-Count` | Gives the total number of matching root records. |
| `Link` | Links to the next and previous pages, where available. |

Change log responses include `ETag` and `Last-Modified` headers based on their latest entry.

The projection list and OpenAPI document can change when projections are added or dropped. Filby serves them without caching headers.

#### Error handling

Expected errors return a JSON body in the form:

```json
{ "error": "..." }
```

See [HTTP](#http) for the status codes and response headers.

Unexpected errors, such as a lost database connection, are thrown. Handle these in your host application to log the failure and return an appropriate `500` response.

#### Framework integration

With [Hono](https://hono.dev/), pass the incoming request directly to Filby:

```js
app.all('/api/*', (c) =>
  filby.fetch(c.req.raw, { basePath: '/api' })
);
```

With Express, adapt the incoming request and copy Filby's response back to Express:

```js
app.use('/api', async (req, res, next) => {
  try {
    const url =
      `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const request = new Request(url, {
      method: req.method
    });

    const response = await filby.fetch(request, {
      basePath: '/api'
    });

    res.status(response.status);

    response.headers.forEach((value, name) => {
      res.set(name, value);
    });

    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    next(err);
  }
});
```

#### OpenAPI documentation

Filby generates `/openapi.json` from your projection definitions, so you do not need to maintain a separate API schema.

For each projection with a root entity, the document describes its path, declared filters, paging parameters and response structure, including selected fields, nests and lookups. You can use OpenAPI tooling to generate clients, validate requests and provide interactive documentation.

Set `options.info` to customise the document's title, version and description. The example application uses the generated document to serve Swagger UI.

See [OpenAPI document](#openapi-document) for details of the generated contents.

### Deploying

Run Filby inside your application as a cluster of two or more instances, so that the API stays available while one instance restarts. Each instance calls `init()` at startup, which applies any migrations that have not yet been applied before the instance serves requests.

Deploy new migrations with a rolling deployment, replacing the instances one at a time. The first new instance applies the migrations, and the remaining instances find nothing left to apply. Instances that are still running continue to serve HTTP requests while the migrations are applied, and serve the new data and definitions once they have been applied, because Filby reads projection and enum definitions from the database for each request. Hook handlers are different. Your application subscribes to hooks when it starts, so only an instance running the new code can handle a hook that a migration adds. Replacing every instance ensures that each one has the current handlers.

Several instances can start at the same time. `init()` holds a database lock while it applies migrations, so one instance applies them while the others wait, and the waiting instances continue once it has finished. Notification delivery pauses across all instances while migrations are applied, as described under [Migrations](#migrations).

Each hook notification is delivered to one instance per attempt, so a handler runs once in the cluster rather than once per instance. During a rolling deployment, a notification for a new hook may be claimed by an instance that started before the hook was added and has no subscriber for it. That attempt fails and is retried, as described under [Delivery and retries](#delivery-and-retries), and a later attempt is normally claimed by a new instance.

#### Applying migrations separately

You can also apply migrations without deploying, with the [`filby migrate`](#apply-migrations) command:

```bash
npx filby migrate --config filby.json
```

A migration that needs no new handler code, such as one that adds a change set or a projection, can be applied this way, for example from a CI step. The running instances serve the change without restarting, and the next deployment finds nothing left to apply. A migration that adds a hook, or otherwise needs new handler code, should still go out with a rolling deployment of that code. Applied on its own, it would leave the running instances without a handler, and its notifications would fail and be retried until they ran out of attempts or the handler was released.

A rolling deployment for every migration is simpler, because every change takes the same route, but a migration that only loads data waits for a deployment that replaces every instance. Applying such migrations with `filby migrate` makes them take effect sooner, at the cost of choosing a route for each change. Rolling deployment remains the recommended approach.

If you apply every migration with `filby migrate`, the instances can call `init({ migrate: false })`. This prepares the instance in the same way as `init()`, but checks that every migration has been applied instead of applying any. It does not take the migration lock, so starting an instance does not pause notification delivery, and the instances can connect as a database user without permission to change the schema. Run `filby migrate` before each deployment that includes migrations. An instance whose migrations have not been applied fails at startup with an error that names the first one.

### Distributing projections as modules

An application can install a projection as an npm module instead of requesting it over HTTP. The module contains the projection's change log and the documents at every change set, including change sets that have not yet taken effect. An application deployed in November with a change set that takes effect on 1 January starts using the new data on 1 January without being redeployed. Modules suit reference data that is small enough to ship with an application. Read larger projections through the API.

Two tools build a module. `filby export` applies your migrations to a database and writes one projection's change sets and documents to a [bundle](#projection-bundle) file. [filby-pack](https://github.com/acuminous/filby-pack) turns the bundle into an npm package, which you then publish with `npm publish`. Neither needs a running application, so they usually run in the CI pipeline of the repository that holds your migrations, against an empty database. Change set ids are assigned as the migrations are applied, so a module built from the same migrations as your production database uses the same ids.

`filby export` reads the Filby [configuration](#configuration) from a JSON file. In CI, it points Filby at a Postgres service container and the repository's migrations:

```json
{
  "database": {
    "host": "localhost",
    "user": "filby",
    "password": "filby",
    "database": "filby"
  },
  "migrations": ["migrations"]
}
```

filby-pack is released separately from Filby, so you choose when to take changes to the modules it generates. Its README explains how packages are versioned and what a module exports.

## Upgrading from 0.14.0 to 1.0.0

Most of the upgrade happens automatically. The first time `init()` runs with 1.0.0, Filby applies its own migrations, which convert the tables and data created by 0.14.0. A few things can stop those migrations or need changing by hand, so work through the steps below in order. The [CHANGELOG](CHANGELOG.md) lists every change in the release.

### Before you upgrade

1. Check your runtime. Filby 1.0.0 needs Node.js 22.12 or later and PostgreSQL 15 or later. 0.14.0 did not state a minimum PostgreSQL version, so check yours if it is older.
2. Back up the database, so that you can return to 0.14.0 if you need to.
3. Check for change sets that contain more than one frame for the same key, as described below.
4. Find any of your own SQL that will need changing, as described in [Your own SQL](#your-own-sql). Make the changes when you deploy 1.0.0, not before.

#### More than one frame for the same key

A change set may now contain only one frame for each key of an entity. 0.14.0 allowed several, and the frame with the highest id won. If an existing change set breaks the new rule, the upgrade stops before converting the entity tables, `init()` rejects, and the error names the first duplicate:

```
Entity 'VAT Rate v1' has more than one frame with key (type=standard) in change set '2021 VAT Rates'
```

To list every duplicate for an entity, run a query like this one against your 0.14.0 database, replacing `vat_rate_v1` with the entity's table and `type` with its key fields:

```sql
SELECT cs.id AS change_set_id, cs.description, x.type, COUNT(*) AS frames, MAX(x.fby_frame_id) AS winning_frame_id
FROM vat_rate_v1 x
INNER JOIN fby_data_frame f ON f.id = x.fby_frame_id
INNER JOIN fby_change_set cs ON cs.id = f.change_set_id
GROUP BY cs.id, cs.description, x.type
HAVING COUNT(*) > 1
ORDER BY cs.id;
```

The frame in `winning_frame_id` is the one 0.14.0 served, so keep it and delete the others for that key and change set. Delete each frame's row from the entity table first, then its row from `fby_data_frame`. Filby does not delete data for you. If `init()` has already stopped on a duplicate, fix the data and call `init()` again, and the upgrade continues from the step that failed.

### What happens when init() runs

The first `init()` with 1.0.0 applies Filby's own migrations to the existing database. They record your entity definitions in new metadata tables, recreate the aggregate functions, relabel existing `POST` frames as `SET`, and recreate each entity check so that it applies only to `SET` frames, keeping its name and expression. Your reference data is not otherwise changed.

The migrations also put change sets back in effective date order. 0.14.0 assigned ids in the order change sets were added, so a change set added with an earlier effective date than an existing one, for example to backfill data, could have a higher id. The upgrade re-issues each change set that is out of order as a new change set with the same description, effective date and data. The change log gains the re-issued change sets, the originals drop out of it, and `ADD_CHANGE_SET` notifications are scheduled for the re-issued ones. Anything that reads the original ids still gets the original data. See [Correcting and re-issuing data](#correcting-and-re-issuing-data).

Filby no longer uses the pgcrypto extension. The upgrade leaves it installed, so drop it if nothing else in the database needs it.

Error messages now quote fields and enums as they were written in your migrations. Fields and enums created by 0.14.0 are the exception. 0.14.0 did not record how they were written, so messages about them use their lower case names.

### Your own SQL

The `POST` action is now called `SET`. YAML, JSON and CSV migrations that say `POST` keep working, but SQL that uses the literal `'POST'` fails, because the database value has been renamed. Change it to `'SET'` in your functions and views.

Entity tables gain two columns, `fby_change_set_id` and `fby_action`, which hold the change set and action of each row's frame. SQL that inserts rows into an entity table directly must supply both. `fby_notify_add_change_set` now takes the change set id as its first argument, so update any SQL that calls it.

None of this works on 0.14.0, because the `SET` value and the new columns do not exist until the upgrade. Instead, recreate the affected functions and views in a new SQL migration that you deploy with 1.0.0. Filby applies its own migrations before yours, so your migration runs after the upgrade, during the same `init()`. SQL migrations that have already been applied do not need changing for the upgrade, but they may stop a new database from being created. See [Creating new databases from your migrations](#creating-new-databases-from-your-migrations).

### Application code

Some of Filby's API behaves differently in 1.0.0. Check your application for the following:

| Change | What to do |
| ------ | ---------- |
| A `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED` listener receives `{ error, notification }` instead of the notification with an `err` property. The `ErrorNotification` type is removed. | Read `error` and `notification` from the payload. |
| `Filby.NOTIFICATION_ERROR` is emitted after every failed delivery attempt, and when polling or a database connection fails. | Expect more of these events. Check for `notification` to tell delivery failures from polling and connection failures. See [Monitoring failures](#monitoring-failures). |
| A notification for a hook with no subscriber counts as a failed attempt and is retried. In 0.14.0 it was discarded. | Subscribe to every hook you declare, or drop the hooks you no longer use. |
| `getChangeLog` returns change sets in id order, oldest first. | Remove any sorting you added to work around the previous order. |
| `getAggregates` rejects when the change set does not exist, instead of returning an empty array. | Handle the rejection. |
| `withTransaction` runs its callback in a transaction, which is rolled back if the callback throws. In 0.14.0 each statement was committed as it ran. | Check any code that relied on earlier statements being kept after a later one failed. |
| Deleting a change set with SQL also deletes its rows from the entity tables. | Delete a superseded change set and its re-issue in the same statement. See [Correcting and re-issuing data](#correcting-and-re-issuing-data). |
| In TypeScript, `getProjection`, `getChangeSet` and `getCurrentChangeSet` can return `undefined`. | Handle the `undefined` case. |

### Creating new databases from your migrations

Upgrading an existing database does not run your old migration files again, but creating a new one does, for example for local development or tests. 1.0.0 checks migrations more strictly than 0.14.0, so a file that was applied without complaint may now fail:

- A change set with more than one frame for the same key fails. Remove the extra frames from the file, as you did in the database.
- An `ADD_HOOK` with a `projection` must use the `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET` event. In 0.14.0, a projection on an `ADD_PROJECTION` or `DROP_PROJECTION` hook was ignored, so remove it.
- A SQL migration that inserts `'POST'` frames, or inserts rows into an entity table without `fby_change_set_id` and `fby_action`, fails. Change it as described in [Your own SQL](#your-own-sql).
- A `DROP_ENTITY` must include `operation: DROP_ENTITY`, like every other operation.

Filby does not compare your migration files with the versions it has already applied, so you can correct old files without affecting existing databases.

A new database may also hold slightly different values from one loaded by 0.14.0. CSV cells and inline YAML and JSON values are now passed to PostgreSQL as written, so `007` stays `007` in a `TEXT` column and `1.50` stays `1.50` in a `NUMERIC` column, and a YAML field with no value is stored as `NULL` rather than an empty string.

### Checking the upgrade

After the first `init()`:

1. Read the change log of each projection. Re-issued change sets have `reissuedFrom` set to the id of the change set they replace.
2. Call `filby.getNotificationStatus()` once notifications have started. A rising exhausted or overdue count, or `Filby.NOTIFICATION_ERROR` events reporting `No subscribers for hook`, point to a hook that needs a subscriber. See [Health checks](#health-checks).
3. Request a projection at a change set id your clients already use, and confirm the documents are the ones they expect.

## Reference

### Configuration

| Key | Type | Default | Notes |
| --- | ---- | ------- | ----- |
| `database` | object | | Passed through to node-pg's `Pool`, so any `PoolConfig` key works, and node-pg reads `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` from the environment for anything not given. A `types` entry is wrapped so Filby can add its own parsers |
| `migrations` | list of paths | `['migrations']` | Relative to the working directory. |
| `notifications.interval` | duration | `1m` | How often Filby polls for notifications |
| `notifications.initialDelay` | duration | `10s` | The delay before the first poll after `startNotifications` |
| `notifications.maxAttempts` | integer | `10` | Attempts before a notification is exhausted |
| `notifications.maxRescheduleDelay` | duration | `1h` | The longest delay before a retry |
| `notifications.handlerTimeout` | duration | `30s` | How long a handler may run before its signal is aborted and the attempt fails |
| `notifications.listen` | boolean | `false` | Whether to hold a connection that listens for scheduled notifications and polls at once |

Durations such as `30s`, `5m` and `1h` use [parse-duration](https://www.npmjs.com/package/parse-duration) syntax; zero is allowed and a negative or unparseable value is rejected. The config is validated when Filby is constructed, and an unknown key or a bad duration is rejected. Every schema problem is reported in one error, one per line, and the durations are checked once the schema passes, again all together.

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

### DSL

A migration is a YAML or JSON list of operations, each with an `operation` and the keys below. The list must have at least one entry. 

#### ADD_ENUM

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | Canonicalised for the type name and `fby_enum` |
| `values` | list of strings, at least one | yes | Kept as written, in order |
| `description` | string | no | Accepted but not stored |

The enum must not already exist.

#### ALTER_ENUM

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `add` | list of strings, at least one | yes | Appended after the existing values, in order |
| `description` | string | no | Accepted but not stored |

The enum must exist, and must not already have the value. A change set that uses an added value must be in a later migration file.

#### DROP_ENUM

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `description` | string | no | Accepted but not stored |

The enum must exist, and no column may still use the type.

#### ADD_ENTITY

| Key | Type | Required | Default | Notes |
| --- | ---- | -------- | ------- | ----- |
| `name` | string | yes | | |
| `version` | integer | no | 1 | |
| `description` | string | no | | Stored in `fby_entity` |
| `fields` | map of name to type, or to `{ type, nullable }`; or list of `{ name, type, nullable }`; at least one | yes | | `nullable` defaults to `true`; key fields are never nullable |
| `key` | list of field names, at least one | one of `key`, `identified_by` | | |
| `identified_by` | list of field names, at least one | one of `key`, `identified_by` | | Equivalent to `key` |
| `checks` | map of name to expression, at least one | no | | Each becomes a check constraint named `chk_<name>`, applied to `SET` frames only |

The key fields must be fields of the entity, each field type must be a valid PostgreSQL type, and the entity version must not already exist.

#### DROP_ENTITY

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `version` | integer | yes | |
| `description` | string | no | Accepted but not stored |

Drops the metadata, the table and the aggregate function. The entity must exist, no projection may depend on it, and no change set may hold frames for it.

#### ADD_PROJECTION

| Key | Type | Required | Default | Notes |
| --- | ---- | -------- | ------- | ----- |
| `name` | string | yes | | Kept as written |
| `version` | integer | no | 1 | |
| `description` | string | no | | Served by `GET /projections` and the OpenAPI document |
| `root` | `Entity@n` | one of `root`, `dependencies` | | Must name the version with `@n` |
| `dependencies` | list of `{ entity, version }`, at least one | one of `root`, `dependencies` | | For a projection whose function you write |
| `fields` | list of field names or `{ field, as }`, at least one | no | every field | Root only |
| `parameters` | map of name to `{ field, match }`, at least one | no | | Root only; `match` defaults to `equals` |
| `order` | list of `{ field, direction, nulls }`, at least one | no | the key | Root only; `direction` `ASC` or `DESC`, default `ASC`; `nulls` `FIRST` or `LAST` |
| `paging` | `{ page_size, page_max }`, both integers of at least 1 | no | | Root only; both required |
| `nest` | map of name to nest | no | | Root only |
| `lookup` | map of name to lookup | no | | Root only |

A parameter's `match` is one of `equals`, `prefix`, `in`, `contains`, `range`, `gt`, `gte`, `lt` and `lte`, and its `field` must be a field of the root or a path. A path such as `Beach Routes.Beach.Surfaces` names a nest or lookup at each level, starting from the root, and ends with a field of the last one. A lookup can only be the last name in a path. Only `in` and `contains` can be used with an array field, and `contains` can only be used with an array field. The canonical parameter names `change_set_id`, `page_offset` and `page_size` are reserved.

A nest has these keys. A lookup has `entity`, `on` and `fields` only, and its `fields` must name at least one field.

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `entity` | `Entity@n` | yes | Must name the version with `@n` |
| `on` | map of child field to parent field, at least one | yes | A lookup's `on` must cover the whole key of its entity |
| `fields` | list of field names or `{ field, as }` | no | May be empty on a nest |
| `order` | list of `{ field, direction, nulls }`, at least one | no | The child's key is appended |
| `nest` | map of name to nest | no | To any depth |
| `lookup` | map of name to lookup | no | |

A projection must specify either `root` or `dependencies`, not both, and the keys that need a root cannot be used without one. The projection version must not already exist, and every entity it names must exist. Every field named by a parameter, an order, a `fields` list or an `on` map must be a field of the entity it applies to. A parameter may not use a reserved name. A nest or lookup name may not repeat a field of its parent entity, may not begin with `fby_`, may not contain a dot, and may not be used twice at one level. A lookup must join on the whole key of its entity. A `fields` entry `{ field, as }` carries `field` under the name `as`. Each property a `fields` list produces must not repeat another property or a nest or lookup name at its level, and must not begin with `fby_`. At the root, it must not take the name of a field that a nest or lookup joins on.

#### DROP_PROJECTION

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `version` | integer | yes | |
| `description` | string | no | Accepted but not stored |

Deletes the projection, the hooks that name it, its notifications and its generated function, and schedules `DROP_PROJECTION` notifications. The projection must exist.

#### ADD_HOOK

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | Unique; kept as written; the name to `subscribe` to |
| `event` | `ADD_PROJECTION`, `DROP_PROJECTION`, `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET` | yes | |
| `projection` | `Projection@n`, or a name with `version` | no | Only with `ADD_CHANGE_SET` or `COMMENCE_CHANGE_SET`; otherwise the hook is general |
| `version` | integer | with a `projection` that has no `@n` | |
| `description` | string | no | Stored in `fby_hook` |

The hook must not already exist, and a projection it names must exist.

#### DROP_HOOK

| Key | Type | Required | Notes |
| --- | ---- | -------- | ----- |
| `name` | string | yes | |
| `description` | string | no | Accepted but not stored |

Deletes the hook and its notifications. The hook must exist.

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
| `action` | `SET` or `DELETE`, in any case | without `source`, or with a `source` that has no `action` column | |
| `data` | list of objects, at least one | one of `data`, `source` | Keys are field names; a map or list value is stored as JSON |
| `source` | path | one of `data`, `source` | A CSV file relative to the migration file, with a header row of field names. A `.tsv` extension, in any case, means tab-separated |

A change set must specify either `changes` or `frames`, not both, and a calendar effective date needs a `timezone`. Each CSV file must parse. A frame's action is given either on the frame or in an `action` column with every cell filled, but not both. Every entity and field the change set names must exist, and it may hold only one frame per key for each entity. When Postgres rejects a row, the error names the file and the row, as `/0/changes/1/data/2` for inline data or `./csv/parks/park.csv:18` for a CSV row with the header as line 1, and keeps Postgres's SQLSTATE.

#### Equivalent forms

The forms in each row mean the same thing, all of them are permanent, and they can be mixed freely.

| Form | Equivalent form |
| ---- | --------------- |
| `fields` as a map of name to type, or to `type` and `nullable` | `fields` as a list of `name`, `type` and optionally `nullable` |
| `key` | `identified_by` |
| `changes` | `frames` |
| `entity: Park@1` in a frame or a dependency | `entity: Park` with `version: 1` |
| `projection: Parks@1` in a hook | `projection: Parks` with `version: 1` |

### API

Methods that read the database return promises and run in their own transactions.

#### Lifecycle

| Method | Behaviour |
| ------ | --------- |
| `new Filby(config)` | Validates the configuration and creates the connection pool. See [Configuration](#configuration). |
| `filby.init(options?)` | Connects to the database and applies Filby's migrations, followed by your application's migrations. Pass `{ migrate: false }` to check that the migrations have been applied without applying them. |
| `filby.startNotifications()` | Starts notification polling and, if `notifications.listen` is enabled, database listening. Does nothing if polling has already started. |
| `filby.stopNotifications()` | Signals active handlers to stop, stops listening and polling, and waits for the current delivery attempt to be recorded. |
| `filby.stop()` | Stops notifications and closes the connection pool. |

During `init()`, Filby holds the advisory lock identified by `Filby.MIGRATION_LOCK_KEY`. This pauses notification delivery across all instances. Before applying migrations, it waits for delivery attempts already in progress, up to the configured handler timeout.

`init()` rejects if a migration fails or the checksum of one of Filby's own migrations has changed.

`init({ migrate: false })` does not take the lock and does not apply migrations. It rejects with an error naming the first outstanding migration if any of Filby's migrations, or any migration in your configured directories, has not been applied. Migrations recorded in the database without a matching file are ignored. See [Applying migrations separately](#applying-migrations-separately).

#### Notification handlers

| Method | Behaviour |
| ------ | --------- |
| `filby.subscribe(name, handler)` | Registers a handler for a named hook or a notification monitoring event. |
| `filby.unsubscribe(name, handler?)` | Removes the specified handler. Omit `handler` to remove every handler registered for that name. |
| `filby.unsubscribeAll()` | Removes all handlers from all hooks and events. |

Hook handlers receive two arguments:

```js
filby.subscribe('hook-name', async (notification, { signal }) => {
  // Handle the notification, using signal to respond to cancellation.
});
```

Monitoring listeners receive an object containing `error` and, for delivery failures, `notification`:

```js
filby.subscribe(
  Filby.NOTIFICATION_ERROR,
  ({ error, notification }) => {
    // Report the error.
  }
);
```

The monitoring events are `Filby.NOTIFICATION_ERROR` and `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED`.

See [Hooks and notifications](#hooks-and-notifications) for delivery, cancellation and retry behaviour.

#### Notification status

Call `filby.getNotificationStatus()` to inspect polling activity and notification counts.

| Field | Meaning |
| ----- | ------- |
| `started` | Whether notification polling has started. |
| `poller` | `idle` between polls, `running` during a poll, briefly `stopped` during shutdown, or `undefined` when polling is not active. |
| `lastSuccessfulPollAt` | When the last successful poll completed. |
| `failuresSinceLastSuccess` | The number of failed polls since the last successful one. |
| `lastError` | The most recent recorded error, as `{ at, message }`. |
| `pending` | Notifications that have not yet been delivered. |
| `overdue` | Undelivered notifications whose scheduled time has passed. |
| `exhausted` | Notifications that have reached `maxAttempts` and will not be retried. |

The polling history fields—`lastSuccessfulPollAt`, `failuresSinceLastSuccess` and `lastError`—are held in memory. They survive `stopNotifications()` but reset when the application restarts. A successful poll resets the failure count to zero but retains `lastError`.

The notification counts overlap: an exhausted notification is also overdue. The method rejects if the counts cannot be read from the database.

#### Projections and change sets

| Method | Behaviour |
| ------ | --------- |
| `filby.getProjections()` | Returns all projections as `{ id, name, version, key }`, with no guaranteed order. |
| `filby.getProjection(name, version)` | Returns the matching projection, or `undefined` if it does not exist. |
| `filby.getChangeLog(projection, { since })` | Returns change sets affecting the projection, in ascending id order. Superseded change sets are omitted. Only ids greater than `since` are returned; `since` defaults to 0. |
| `filby.getCurrentChangeSet(projection)` | Returns the live change set with the latest effective date that is not after the database's current time, or `undefined` if none exists. |
| `filby.getChangeSet(id)` | Returns a change set by id, including a superseded one, or `undefined` if it does not exist. |

Pass the projection object returned by `getProjection()` or `getProjections()` to methods that accept a `projection`.

##### Reading the change log

Each entry returned by `getChangeLog()` contains:

| Field | Meaning |
| ----- | ------- |
| `id` | The change set id. |
| `effective` | When the change set takes effect. |
| `description` | The change set's description. |
| `lastModified` | When the change set was last modified. |
| `entityTag` | The change set's entity tag. |
| `reissuedFrom` | The original change set id, when this is a re-issued change set. |

Remember the last change set id you successfully processed and pass it as `since` to resume from that point:

```js
async function catchUp(projection, lastChangeSetId) {
  const changeSets = await filby.getChangeLog(projection, {
    since: lastChangeSetId
  });

  for (const changeSet of changeSets) {
    await mirror(projection, changeSet);
    lastChangeSetId = changeSet.id;
  }

  return lastChangeSetId;
}
```

#### Reading data

| Method | Behaviour |
| ------ | --------- |
| `filby.getAggregates(changeSetId, name, version)` | Returns the entity's aggregate rows at the specified change set. Rejects if the entity version or change set does not exist. |
| `filby.getDocuments(projection, changeSetId, { parameters, pageOffset, pageSize })` | Returns `{ documents, total }` for a projection declared with a root entity. |

##### Reading projection documents

Use `getDocuments()` to read the same document structure defined by a projection:

- Nests appear as arrays.
- Lookups appear as objects, or `null` when no matching record exists at the change set.
- Nested documents include their own nests and lookups.

Pass filters in `parameters`. Use parameter names without the SQL function's `p_` prefix, such as `code`, `berths_from`, `berths_to` or `heating`.

Values must have the types expected by the projection. Supply an array for an `in` parameter. Omitted parameters do not filter the results; unknown parameters cause the method to reject.

Use `pageOffset` and `pageSize` to request a page. These are ignored if the projection has no `paging` configuration. `total` always counts all matching root records, regardless of the requested page.

```js
async function getParks(changeSetId, code) {
  const projection = await filby.getProjection('Parks', 1);

  if (!projection) {
    throw new Error('Projection Parks@1 does not exist');
  }

  const { documents, total } = await filby.getDocuments(
    projection,
    changeSetId,
    {
      parameters: { code },
      pageOffset: 0,
      pageSize: 50
    }
  );

  return { parks: documents, total };
}
```

Values use node-pg's type conversions at every level. For example, timestamps are `Date` objects and enum arrays are arrays of strings.

`getDocuments()` does not support projections declared with `dependencies` instead of a root entity. For those projections, call the custom SQL function through `withTransaction()`.

#### Serving HTTP requests

Use `filby.fetch(request, options)` to serve projection discovery, change logs, documents and the generated OpenAPI document.

See [Serving over HTTP](#serving-over-http) for routes, options and framework integration, and [HTTP](#http) for status codes and response headers.

#### Running SQL in a transaction

Use `filby.withTransaction(callback)` when you need to run SQL directly. The callback receives a [node-pg](https://node-postgres.com/) client. Filby commits the transaction when the callback resolves and rolls it back if the callback rejects.

For example, to read a projection implemented with a custom SQL function:

```js
async function getPriceList(changeSetId) {
  return filby.withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM get_price_list_v1($1)',
      [changeSetId]
    );

    return rows;
  });
}
```
### HTTP

`filby.fetch(request, { basePath, info })` handles `GET` requests on the routes below. Paths are relative to `basePath`.

See [Serving over HTTP](#serving-over-http) for framework integration and usage examples.

#### Routes

| Route | Successful response |
| ----- | ------------------- |
| `/projections` | `200` with the projection list. |
| `/changelog?projection=<name>&version=<n>` | `200` with the projection's change log. |
| `/projections/<name>/v<n>` | `307` redirect to the current change set. |
| `/projections/<name>/v<n>?changeSetId=<id>` | `200` with the projection's documents. |
| `/openapi.json` | `200` with the generated OpenAPI document. |

URL-encode projection names in paths. A name that cannot be URL-decoded produces a `400` response.

#### Change logs

`GET /changelog` accepts:

| Parameter | Required | Validation |
| --------- | -------- | ---------- |
| `projection` | Yes | Must identify an existing projection together with `version`. |
| `version` | Yes | Must be an integer. |
| `since` | No | Must be an integer when supplied. |

Missing required parameters or invalid integers produce a `400` response. An unknown projection produces a `404`.

#### Projection data

Without `changeSetId`, Filby redirects to the projection's current change set. The response is `307`, with the destination in `Location`. All other query parameters are preserved.

An unknown projection, or one with no current change set, produces a `404`.

With `changeSetId`, Filby returns the documents at that change set. Requests can include the projection's declared filters and, where supported, `page` and `pageSize`.

The following produce a `400` response:

- `changeSetId` is not an integer or does not identify an existing change set.
- A parameter is not declared or recognised.
- A parameter is repeated without being configured as an `in` match.
- A supplied value cannot be converted to the expected PostgreSQL type.
- `page` or `pageSize` is not a positive integer.
- `page` or `pageSize` is supplied for a root-based projection without `paging` configured.

An unknown projection produces a `404`.

The HTTP handler reserves `page`, `pageSize` and `changeSetId`. Do not use these names for declared filters: the handler reads them as HTTP controls, so they cannot reach the projection as filter values.

##### Custom SQL projections

For a projection declared with `dependencies`, Filby calls `get_<name>_v<n>(changeSetId)` and returns its rows without reshaping them.

These projections accept only `changeSetId`, `page` and `pageSize`:

- Without `pageSize`, all rows are returned.
- With `pageSize`, results are paged by row.
- Supplying `page` without `pageSize` produces a `400`.
- Both paging parameters must be positive integers.

If the projection's SQL function does not exist, Filby returns a `500`.

#### Error responses

Expected errors have a JSON body:

{
  "error": "<message>"
}

Unmatched paths return `404`. A method other than `GET` on a recognised route returns `405` with `Allow: GET`.

PostgreSQL data errors, identified by SQLSTATE class 22, return `400` with PostgreSQL's error message. Other unexpected errors are thrown to the host application rather than converted into an HTTP response.

#### Response headers

| Header | Sent on | Value |
| ------ | ------- | ----- |
| `Content-Type` | Every response with a body | `application/json` |
| `ETag` | Projection responses and non-empty change logs | The change set's entity tag, or the latest change log entry's entity tag. |
| `Last-Modified` | Projection responses and non-empty change logs | The corresponding change set's `lastModified`, formatted as an RFC 1123 date. |
| `Cache-Control` | Projection responses | `max-age=31536000, immutable` |
| `X-Total-Count` | Projection responses | The total number of matching records, regardless of the requested page. |
| `Link` | Paged projection responses | Links to the next and previous pages, where available. |
| `Location` | Redirect responses | The path and query with `changeSetId` set to the current change set. |
| `Allow` | `405` responses | `GET` |

A projection's `ETag` identifies the change set rather than being calculated from the response body. It is shared across pages and filter combinations at that change set; the request URL distinguishes those responses.

Pagination links use `<url>; rel="next"` and `<url>; rel="prev"`, preserving all other query parameters.

### OpenAPI document

`GET /openapi.json` returns an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document generated from your projection definitions. It describes the API routes, filters, paging controls, response schemas and headers.

#### Configuration

- `options.info` sets the document's `title`, `version` and optional `description`. It defaults to `{ title: 'Filby', version: '1.0.0' }`.
- A non-empty `options.basePath` is included as the document's server URL.

#### Response schemas

For projections with a root entity, Filby generates response schemas from the selected fields, nests and lookups. The schemas include enum values and field nullability. Non-nullable fields are required, nests are arrays, and lookups are objects that may be `null`.

For custom SQL projections declared with `dependencies`, response records have an unconstrained schema because Filby cannot infer the function's output structure.

#### JSON types

Schemas describe the values returned over HTTP, which may differ from their PostgreSQL types:

| PostgreSQL type | JSON representation |
| --------------- | ------------------- |
| `BIGINT`, `INT8`, `NUMERIC`, `DECIMAL` | Strings, matching node-pg's default conversions. |
| `DATE` and timestamp types | Strings with the `date-time` format. |
| `JSON`, `JSONB` and unrecognised types | Unconstrained values. |

Array fields use the corresponding element schema. Nullable fields also allow `null`.

#### Filby extensions

The OpenAPI document carries three extensions that describe how Filby joins and filters documents:

| Extension | Appears on | Value |
| --------- | ---------- | ----- |
| `x-filby-on` | Each nest and lookup in a response schema | The join, mapping each field of the nested record to the parent field it matches. |
| `x-filby-match` | Each declared query parameter | The parameter's match: `equals`, `prefix`, `in`, `contains`, `range`, `gt`, `gte`, `lt` or `lte`. |
| `x-filby-field` | Each declared query parameter | The path of the field the parameter filters, as a list of the property names a document uses, including any `as` alias, for example `["seasons", "rates", "band"]`. |

A client can use `x-filby-match` and `x-filby-field` to label filter controls without inferring them from parameter names. A `range` parameter appears as two query parameters, `<name>_from` followed by `<name>_to`, which carry the same match and field. A parameter may filter on a field that documents do not carry, such as one left out by `fields`. That parameter has no `x-filby-field`, because the document has no property to name.

Response schemas contain only `x-filby-on`. If you validate them with Ajv in strict mode, register it with `ajv.addKeyword('x-filby-on')`. If you also compile parameter objects, register `x-filby-match` and `x-filby-field` in the same way.

### Command line

Use Filby's command line tool to check migration files without a database, to apply migrations, and to export projections for distribution as npm modules.

`validate` and `preview` accept one or more directories, and use `migrations` if you omit them. Neither command validates SQL migration files. `migrate` applies migrations as described in [Applying migrations separately](#applying-migrations-separately). `export` writes the bundles described in [Distributing projections as modules](#distributing-projections-as-modules).

#### Validate migrations

Use `validate` to check migration files before applying them:

```bash
npx filby validate migrations
```

The command checks every file and reports any problems to stderr. It exits with code 0 if all checks pass, or 1 if any fail, making it suitable for CI.

#### Preview SQL

Use `preview` to inspect the SQL your migrations will produce:

```bash
npx filby preview migrations
```

It performs the same checks as `validate`, then writes the SQL to stdout:

- Directories are processed in the order supplied.
- Within each directory, migrations are written in level order.
- Each migration is preceded by a `-- <file>` comment.
- SQL migration files are copied verbatim.

Use the output to inspect a change before applying it or to review a SQL diff.

If any migration fails validation, the command reports the errors to stderr, writes no SQL and exits with code 1.

#### Apply migrations

Use `migrate` to apply outstanding migrations to a database without starting your application:

```bash
npx filby migrate --config filby.json
```

| Option | Value |
| ------ | ----- |
| `--config` | A JSON file holding a Filby [configuration](#configuration). |

The option is required. The command applies Filby's migrations and then yours, as `filby.init()` does, and exits with code 0. It does not start notifications. If the option is missing, the configuration cannot be read or a migration fails, the command reports the problem to stderr and exits with code 1.

#### Export a projection

Use `export` to apply your migrations and write one projection's [bundle](#projection-bundle):

```bash
TZ=UTC npx filby export --config filby.json --projection 'Parks@1' --out parks-v1.json
```

| Option | Value |
| ------ | ----- |
| `--config` | A JSON file holding a Filby [configuration](#configuration). |
| `--projection` | The projection, as `<name>@<version>`. |
| `--out` | The bundle file to write. Missing directories are created. |

All three options are required. The command applies any outstanding migrations to the configured database, as `filby.init()` does, so use a database it is allowed to change, such as a service container in CI. It does not start notifications. Run it with `TZ=UTC` so that dates are exported correctly, for the reason given under [Configuration](#configuration).

A projection declared with `dependencies` is exported in the same way, using the rows its SQL function returns. Filby cannot describe those rows, so the bundle gives them an unconstrained schema and their dates remain strings in the module.

If an option is missing, the configuration cannot be read or the projection does not exist, the command reports the problem to stderr and exits with code 1.

### Projection bundle

A bundle is a JSON file holding one projection's change log and the documents at every change set. [filby-pack](https://github.com/acuminous/filby-pack) reads it to build an npm module. Other tools can read it too, for example to build a package for another language.

Bundles have their own format version, independent of Filby's version. This section describes format 1. Its JSON Schema is published at https://acuminous.github.io/filby/lib/bundle-schema.json.

| Key | Contents |
| --- | -------- |
| `format` | The bundle format version, `1`. |
| `filby` | The version of Filby that wrote the bundle. |
| `name` | The projection's name. |
| `version` | The projection's version. |
| `description` | The projection's description, or `null`. |
| `schema` | The JSON Schema of one document, as given in the [OpenAPI document](#openapi-document). |
| `changeSets` | The change log, as returned by `getChangeLog`. |
| `documents` | An object keyed by change set id. Each value is the array of every document at that change set, as `GET /projections/<name>/v<n>` returns them with no parameters. |

Values are represented as described under [JSON types](#json-types). Dates and timestamps are ISO 8601 strings, and the schema marks them with `"format": "date-time"` so that a reader can convert them back into dates.

### Database objects

Filby creates and manages:

- Internal tables prefixed `fby_`, holding definitions, change history and notification state.
- A data table and aggregate function for each entity version.
- A query function for each projection.

Entity tables are named `<entity>_v<n>`, and projection functions are named `get_<projection>_v<n>`.

The migration runner uses `migrations` and `migrations_lock` for its bookkeeping. Manage Filby's definitions and data through migrations and the API.

### Migrations

Filby applies its own migrations first, followed by your YAML, JSON and SQL migrations. By default, migrations across all configured directories share one numbering sequence and run in level order. Levels must be unique across those directories; duplicates cause `filby.init()` to fail. 

### Schema and search path

Filby uses the connection's PostgreSQL search path to locate and create database objects. With the default search path, objects are created in the role's own schema if it exists, otherwise in `public`.

To use a different schema, create it and grant the Filby role `USAGE` and `CREATE` permissions. Then set the search path either on the role:

```sql
ALTER ROLE filby SET search_path = reference_data;
```

or in Filby's connection configuration:

```js
const filby = new Filby({
  database: {
    user: 'filby',
    options: '-c search_path=reference_data',
  },
});
```

The configuration applies to every connection Filby opens, including those used for migrations.

Qualify references to types and functions in other schemas, such as `public`. Other connections, including your application's own pool, must use the same search path or schema-qualified names.

## Example application

The [holiday park example](https://github.com/acuminous/filby/tree/main/examples/holiday-park) demonstrates CSV imports, scheduled changes, projections and webhook notifications in a [Hono](https://hono.dev/) application.

### Running the example

Docker is required for the PostgreSQL container.

```bash
git clone https://github.com/acuminous/filby.git
cd filby
npm install
npm run example
```

The API is served under `/api`. Open [Swagger UI](http://localhost:3000/documentation) to try requests, or access the generated OpenAPI document at `/api/openapi.json`. The `/health` endpoint reports notification status.

### Exploring the data

[Filby UI](https://github.com/acuminous/filby-ui) is the best way to explore the example application's data. With the application running, start it in another terminal:

```bash
FILBY_API_HOST=localhost FILBY_API_PORT=3000 npx github:acuminous/filby-ui
```

Use it to browse projections, inspect their change logs and view the data at different change sets.

See the [example migrations](https://github.com/acuminous/filby/tree/main/examples/migrations) for the schema and scheduled changes, and the [CSV files](https://github.com/acuminous/filby/tree/main/examples/migrations/csv) for the data they load.

### Example queries

All requests below use `GET`, with `http://localhost:3000/api` as the base URL.

Omit `changeSetId` to receive a `307` redirect to the current change set, preserving your filters. Supply an id to read a fixed version, including future data. Use the projection's change log to find the id for a particular date.

| Example | Request |
| ------- | ------- |
| Current details for Devon Cliffs | `/projections/Parks%20(Detailed)/v1?code=DC` |
| Current summary for Devon Cliffs | `/projections/Parks%20(Minimal)/v1?code=DC` |
| Catalogue change history | `/changelog?projection=Catalogue&version=1` |
| Catalogue on 1 June 2025 | `/projections/Catalogue/v1?changeSetId=2&code=VIC` |
| VAT rates in August 2026 | `/projections/VAT%20Rates/v1?changeSetId=7` |
| Preview the 2027 catalogue and prices | `/projections/Catalogue/v1?changeSetId=10&code=VIC` |
| A park after its rename | `/projections/Parks%20(Detailed)/v1?changeSetId=6&code=RI` |
| A park after its deletion | `/projections/Parks%20(Minimal)/v1?changeSetId=8&code=GA` |

The deletion example returns an empty array. Query an earlier change set to retrieve the park before it was removed.
