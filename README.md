# Reference Data Framework
A framework for working with time series reference data.

## Contents
- [Introduction](#introduction)
- [Concepts](#concepts) 
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API](#api)
   - [GET /api/$version/$projection/changelog](#get-apiversionprojectionchangelog)
   - [GET /api/$version/$projection/at](#get-apiversionprojectionat)

## Introduction
Most applications require slow moving reference data, which presents the following challenges in a distributed / microservice architecture.

| Challenge | Notes |
|-----------|-------|
| Consistency | Whenever we duplicate our reference data, we increase the likelihood of inconsistency. Even if we have one authoritive source of truth, we may cache the reference data in multiple systems, resulting in temporary inconsisenty unless cache updated are sychronoised. Given the reference data is slow moving, a short period of inconsistency may be acceptable. |
| Load Times | Some reference data sets may be too large to desirably load over a network connection for web and mobile applications. Therefore we should discorage accidentlaly including large data sets into a client bundle, or requesting large data sets over a network. |
| Reliability | Requesting data sets over a network may fail, especially when mobile. Bundling local copies of reference data into the application (providing they are not too large) will aleviate this, but increase the potential for stale data. |
| Stale Data | Even though reference data is slow moving, it will still change occasionally. Therefore we need a strategy for refreshing reference data. |
| Temporality | When reference data changes, the previous values may still be required for historic comparisons. Therefore all reference data should have an effective date. Effective dates can also be used to synchronise updates by including future records when the values are known in advance. This comes at the cost of increased size, and there may still be some inconsistency due to clock drift and cache expiry times. |
| Evolution | Both reference data, and our understanding of the application domain evolves over time. We will at some point need to make backwards incompatible changes to our reference data, and will need to do so without breaking client applications. This suggests a versioning and validation mechanism. The issue of temporality compounds the challenge of evolution, since we may need to retrospecively add data to historic records. In some cases this data will not be known. |
| Local Testing | Applications may be tested locally, and therefore any solution sould work well on a development laptop. |

Solving such a complex problem becomes simpler when broken down. This project provides a server side framework for managing slow moving, time series reference data. It exposes projections of the data via a point-in-time RESTful API, and will notify downstream systems via webhooks when the reference data supporting the projections changes. 

<pre>
                                                                       Webhook
                                    ┌──────────────────────────────────────────────────────────────────────────┐
                                    │                                                                          │
                                    │                                                                          ▼
┌─────────────────┐        ┌────────────────┐    GET /rdf/$version/changelog?projection=$p&version=$v  ┌──────────────┐
│                 │        │                │◀─────────────────────────────────────────────────────────│              │
│                 │        │   Reference    │                                                          │              │
│    PostgreSQL   │◀──────▶│     Data       │                                                          │    Client    │
│                 │        │   Framework    │            GET /api/$version/$projection?changeSetId=$c  │              │
│                 │        │                │◀─────────────────────────────────────────────────────────│              │
└─────────────────┘        └────────────────┘                                                          └──────────────┘
         ▲
         │
         │
┌─────────────────┐
│                 │
│   Data Frames   │
│                 │
└─────────────────┘
</pre>

It can therefore be extended by other systems. For example, the client in the above diagram could be another backend system, caching proxy, a web application, a websocket application, a CI / CD pipeline responsible for building a client side data module, or an ETL process for exporting the reference data to the company data lake.

### Concepts
RDF has four key concepts
<pre>
┌────────────────────────┐                 ┌────────────────────────┐
│                        │                 │                        │
│                        │  coordinates   ╱│                        │
│       Change Set       │──────────────┼──│     Reference Data     │
│                        │                ╲│         Frame          │
│                        │                 │                        │
└────────────────────────┘                 └────────────────────────┘
                                                       ╲│╱
                                                        │
                                                        │ is queried by
                                                        │
                                                        ○
                                                       ╱│╲
                                           ┌────────────────────────┐
                                           │                        │
                                           │                        │
                                           │          View          │
                                           │                        │
                                           │                        │
                                           └────────────────────────┘
                                                       ╲│╱
                                                        │
                                                        │ is transformed by
                                                        │
                                                        ○
                                                       ╱│╲
                                           ┌────────────────────────┐
                                           │                        │
                                           │                        │
                                           │       Projection       │
                                           │                        │
                                           │                        │
                                           └────────────────────────┘
</pre>

| Concept | Notes |
|---------|-------|
| Change&#x00A0;Set | A change set determines which reference data is in effect at a given point in time. |
| Reference&#x00A0;Data&#x00A0;Frame | A reference data frame is a snapshot of some reference data at a point in time. e.g. Tax rates, Product Catalogs, etc. A frame may also indicate the deletion of some reference data. |
| View | A view is a query across the reference data. |
| Projection | A projection transforms a view, typically into a structured JSON object. Projections are automatically exposed via a [RESTful API](#api) |

## API
Each projection is automatically exposed via the following RESTful API. All responses include appropriate [ETag](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag), [Last-Modified](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Last-Modified) and [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control) headers.

### GET /api/$version/$projection/changelog
Returns the change set timestamps that affect this projection.

#### Query Parameters
There are no query parameters.

#### Example
```
GET /api/v1/park/changelog
```

```json
{
  "data": [
    {
      "id": 1,
      "timestamp": 1672012800000,
      "notes": "Park data as of Monday, 26th December 2022 GMT"
    },
    {
      "id": 2,
      "timestamp": 1703548800000,
      "notes": "Park data as of Tuesday, 26th December 2023 GMT"
    }
  ]
}
```

### GET /api/$version/$projection/at
Returns the projected reference data at the given point in time.

#### Query Parameters

| Name      | Required | Type   | Notes |
|-----------|----------|--------|-------|
| changeset | No       | Number | The changeset id to which the reference data should apply. Obtained from the [changelog API](GET--api--version--projection-changelog)  |
| timestamp | No       | Number | The time in milliseconds to which the reference data should apply. May be disabled. |
| offset    | No       | Number | For pagination |
| limit     | No       | Number | For pagination |

Either a changeset or timestamp is required. Using the current timestamp will make the response practically uncachable, so it is strongly advised to use a changeset id or timestamp returned by the [changelog API](GET--api--version--projection-changelog). Since the reference data is slow moving, and can be created far in advance, you should not need to fetch the changelog frequently. Depending on your context, you may also be able to register a webhook and receive notifications of changes to the projected reference data. If you really cannot afford the extra request to obtain the changelog, then you should consider rounding down the current timestamp to the nearest minuite/hour/day to make the response more cacheable.

#### Example
```
GET /api/v1/park/at?changeset=2
```

```json
{
  "data": [
    {
      "code": "DC",
      "name": "Devon Cliffs",
      "calendar": [
        { "event": "Park Open - Owners",
          "timestamp": "2023-03-01T00:00:00Z"
        },
        {
          "event": "Park Open - Guests",
          "timestamp": "2023-03-14T00:00:00Z"
        },
        {
          "event": "Park Close - Guests",
          "timestamp": "2023-11-15T00:00:00Z"
        },
        {
          "event": "Park Close - Owners",
          "timestamp": "2023-11-30T00:00:00Z"
        }
      ]
    },
    {
      "code": "PV",
      "name": "Primrose Valley",
      "calendar": [
        {
          "event": "Park Open - Owners",
          "timestamp": "2023-03-01T00:00:00Z"
        },
        {
          "event": "Park Open - Guests",
          "timestamp": "2023-03-14T00:00:00Z"
        },
        {
          "event": "Park Close - Guests",
          "timestamp": "2023-11-15T00:00:00Z"
        },
        {
          "event": "Park Close - Owners",
          "timestamp": "2023-11-30T00:00:00Z"
        }
      ]
    }
  ],
  "metadata": {
    "offset": 1,
    "limit": 10,
    "count": 39
  }
}
```
## Getting Started

Start by creating a new project and installing rdf...

```bash
mkdir rdf-server
cd rdf-server
npm i reference-data-framework
```

RDF comes bundled with an interactive utility to guide you through the process of adding reference data. When first run it will ask you if you want to initialise a new project.

```bash
npx rdf-util
```

```bash
Welcome to RDF.

Do you want to initialise a new project (Y/n)?
Y
```

This will create a project with the following structure...

| Name         | Type   | Notes |
|--------------|--------|-------|
| migrations   | folder | Stores the reference data SQL migrations files |
| schemas      | folder | Stores the reference data API json schemas |
| projections  | folder | Stores the reference data API projections |
| index.js     | file   | Starts the RESTful API |
| data.json    | file   | Stores the framework data | 
| config.json  | file   | Stores the framework [configuration](#configuration) | 

After successful initialisation RDF will ask if you want to create a change set

```bash
Project initialisation successful.

Do you want to create a change set (Y/n)?
Y
```

After answering `Yes` you will be prompted for the following details...

| Name           | Type   | Requried | Default                         | Notes |
|----------------|--------|----------|---------------------------------|-------|
| Change Set Id  | Number | Yes      | The next number in the sequence | Uniquely identifies a change set, and determines which reference data to use when the `effective from` dates are indentical. | 
| Effective From | String | Yes      |                                 | Must be specified in [ISO 8601 format](https://en.wikipedia.org/wiki/ISO_8601) |
| Notes          | String | No       |                                 | Useful for describing the changes or referencing external documentation        |

```bash
Creating change set. Please specify...

Change Set Id (1):
1

Effective From:
2022-12-26T00:00:00Z

Notes:
Park data as of Monday, 26th December 2022 GMT

Is this correct (Y/n)?
Y

Creating migrations/00001.insert-change-set-1.sql
Done
```

This will create a SQL migration in the `migrations` folder then ask you to add a reference data frame.

```bash
Do you want to add a reference data frame (Y/n)?
Y
```

After answering `Yes` you will be prompted for the following details...

| Name           | Type   | Required | Default                      | Notes |
|----------------|--------|----------|------------------------------|-------|
| Change Set Id  | Number | Yes      | The latest change set number | Associates the reference data with a change set, and by implication, an effective from date. | 
| Action         | String | Yes      | PUT                          | The action may be either 'PUT' or 'DELETE'. |
| Entity Name    | String | Yes      |                              | The entity name. |
| Version        | Number | Yes      | 1                            | Increment the version ONLY when making backwards incompatible changes. |

```bash
Creating reference data frame. Please specify...

Change Set Id (1):
1

Action:
PUT

Entity Name:
Park

Version (1):
1

Is this correct (Y/n)?
Y

Creating migrations/00002.create-park-v1-reference-data-frame-table.sql
Creating migrations/00003.insert-park-v1-reference-data-frames.sql
Done
```

Since the Park entity has not been previously defined, RDF will create a SQL migration placeholder for the table in the `migrations` folder. It will also create a placeholder for inserting the reference data frames. When complete these migration fiels should look somethink like the following...

```sql
-- Example park reference data frame table definition

START TRANSACTION;

CREATE TABLE park_v1 (
  rdf_change_set_id INTEGER REFERENCES rdf_change_set,
  rdf_action rdf_action_type,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY_KEY (rdf_change_set_id, rdf_action, code),
  UNIQUE (rdf_change_set_id, rdf_action, name)
);

CREATE VIEW park_v1_vw (
  SELECT
    cs.effective_from AS rdf_effective_from,
    p.*
  FROM change_set cs
  INNER JOIN park p ON p.rdf_change_set_id = cs.id;
);

END TRANSACTION;
```

```sql
-- Example park data frames
INSERT INTO park_v1 (rdf_change_set_id, rdf_action, code, name) VALUES
(1, 'PUT', 'DC', 'Devon Cliffs'),
(1, 'PUT', 'PV', 'Primrose Valley');
```

Next you will be asked if you want to add more reference data frames.

```bash
Do you want to add another reference data frame (Y/n)?
Y
```

Answering `Yes` will repeat the previous step.

```bash
Creating reference data frame. Please specify...

Change Set Id (1):
1

Action:
PUT

Entity Name:
Park Calendar

Version (1):
1

Is this correct (Y/n)?
Y

Creating migrations/00004.create-park-calendar-v1-reference-data-frame-table.sql
Creating migrations/00005.insert-park-calendar-v1-reference-data-frames.sql
Done
```

```sql
-- Example park calendar reference data frame table definition
START TRANSACTION;

CREATE TYPE event_type AS ENUM ('Park Open - Owners', 'Park Close - Owners', 'Park Open - Guests', 'Park Close - Guests');

CREATE TABLE park_calendar_v1 (
  rdf_change_set_id INTEGER REFERENCES rdf_change_set,
  rdf_action rdf_action_type,
  id SERIAL NOT NULL,
  park_code TEXT NOT NULL REFERENCES park_v1 (code),
  event event_type NOT NULL,
  occurs_at TIMESTAMP WITH TIME ZONE
  PRIMARY KEY (rdf_change_set_id, rdf_action, id),
  UNIQUE (rdf_change_set_id, rdf_action, park_code, event, scheduled_for)
);

CREATE VIEW park_calendar_v1_vw (
  SELECT
    cs.effective_from AS rdf_effective_from,
    pc.*
  FROM change_set cs
  INNER JOIN park_calendar pc ON pc.rdf_change_set_id = cs.id;
);

END TRANSACTION;
```

```sql
-- Example park calendar data frames
INSERT INTO park_calendar_v1 (rdf_change_set_id, rdf_action, id, park_code, event, occurs_at) VALUES
(1, 'PUT', 1, 'DC', 'Park Open - Owners', '2023-03-01T00:00:00Z'),
(1, 'PUT', 2, 'DC', 'Park Open - Guests', '2023-03-14T00:00:00Z'),
(1, 'PUT', 3, 'DC', 'Park Close - Owners', '2023-11-15T00:00:00Z'),
(1, 'PUT', 4, 'DC', 'Park Close - Guests', '2023-11-30T00:00:00Z'),
(1, 'PUT', 5, 'PV', 'Park Open - Owners', '2023-03-01T00:00:00Z'),
(1, 'PUT', 6, 'PV', 'Park Open - Guests', '2023-03-14T00:00:00Z'),
(1, 'PUT', 7, 'PV', 'Park Close - Owners', '2023-11-15T00:00:00Z'),
(1, 'PUT', 8, 'PV', 'Park Close - Guests', '2023-11-30T00:00:00Z');
```

```bash
Do you want to add another reference data frame (Y/n)?
N
```

Now that the reference data frames have been defined and entered, you will be asked if you want to create any additional views.

```bash
Do you want to create an additional view over the reference data (Y/n)?
Y
```

After answering `Yes` you will be prompted for the following details...

| Name           | Type   | Required | Default                      | Notes |
|----------------|--------|----------|------------------------------|-------|
| View Name      | String | Yes      |                              | The view name. |
| Version        | Number | Yes      | 1                            | Increment the version ONLY when making backwards incompatible changes. |

```bash
Creating view. Please specify...

View Name:
Park Full

Version (1):
1

Is this correct (Y/n)?
Y

Creating migrations/00006.create-park-full-view.sql
Done
```

Once again this will create a placeholder migration file in the `migrations` folder.

```sql
-- Example park full view definition
START TRANSACTION;

CREATE VIEW park_full_v1 (
  SELECT
  FROM
    park_vw p
  INNER JOIN park_calendar_vw pc on pc.code = 
);

END TRANSACTION;
```



### 4. Create a view for the reference data

```bash
npx rdf-create-view
```

The will prompt for the following details and create a placeholder file in the `migrations` folder which must be completed manually.

| Name           | Type   | Required | Default | Notes |
|----------------|--------|----------|---------|-------|
| Name           | String | Yes      |         | The view name.                                                         |
| Version        | Number | Yes      |  1      | Increment the version ONLY when making backwards incompatible changes. |
| Notes          | String | Yes      |         | Useful for describing the view or referencing external documentation   |

The view SQL must join across all reference data required by the projection(s), and their change sets. If the projection(s) will transform the view to JSON you may wish to consider the column naming convension described [here](https://www.npmjs.com/package/csvtojson#nested-json-structure)

```sql
CREATE VIEW park_vw AS (
  SELECT
    cs.id AS park_change_set_id,
    cs.effective_from AS park_change_set_effective_from,
    f.action AS park_frame_action,
    p.code AS park_code,
    p.name AS park_name
  FROM
    change_set cs,
    frame f,
    park p
  INNER JOIN cs.id ON f.change_set_id
  INNER JOIN f.id ON p.frame_id
);
```

```sql
CREATE VIEW park_calendar_vw AS (
  SELECT
    cs.id AS park_calendar_change_set_id,
    cs.effective_from AS park_calendar_change_set_effective_from,
    f.action AS park_calendar_frame_action,
    pc.event AS park_calendar_event,
    pc.timestamp AS park_calendar_timestamp
  FROM
    change_set cs,
    frame f,
    park_calendar pc
  INNER JOIN cs.id ON f.change_set_id
  INNER JOIN f.id ON pc.frame_id
);
```

### 5. Add a webhook (optional)


### Configuration
The following configuration options can be specified in rdf.json

| Property Path              | Type    | Required | Default                                                           | Notes |
|----------------------------|---------|----------|-------------------------------------------------------------------|-------|
| migrations.autostart       | Boolean | No       | true                                                              | Applies migrations automatically on server startup      |
| api.changelog.cacheControl | String  | No       | max-age=86400, stale-while-revalidate=86400, stale-if-error=86400 | Configures the Cache-Control header          |
| api.at.disableTimestamps   | Boolean | No       | false                                                             | Disables the timestamp query parameter, forcing clients to specify a change set instead |

