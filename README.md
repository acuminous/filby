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
                              ┌─────────────────────────────────────────────────────────────────────┐
                              │                                                                     │
                              │                                                                     ▼
┌────────┐       ┌────────────────────────┐    GET /api/$version/$projection/changelog ┌────────────────────────┐
│        │       │                        │◀───────────────────────────────────────────│                        │
│        │       │     Reference Data     │                                            │                        │
│   DB   │◀─────▶│       Framework        │                                            │         Client         │
│        │       │                        │           GET /api/$version/$projection/at │                        │
│        │       │                        │◀───────────────────────────────────────────│                        │
└────────┘       └────────────────────────┘                                            └────────────────────────┘
                              ▲
                              │
                              │
                              │
                 ┌────────────────────────┐
                 │                        │
                 │     Reference Data     │
                 │         Frames         │
                 │                        │
                 └────────────────────────┘
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
          "timestamp": "20230301T00:00:00Z"
        },
        {
          "event": "Park Open - Guests",
          "timestamp": "20230314T00:00:00Z"
        },
        {
          "event": "Park Close - Guests",
          "timestamp": "20231115T00:00:00Z"
        },
        {
          "event": "Park Close - Owners",
          "timestamp": "20231130T00:00:00Z"
        }
      ]
    },
    {
      "code": "PV",
      "name": "Primrose Valley",
      "calendar": [
        {
          "event": "Park Open - Owners",
          "timestamp": "20230301T00:00:00Z"
        },
        {
          "event": "Park Open - Guests",
          "timestamp": "20230314T00:00:00Z"
        },
        {
          "event": "Park Close - Guests",
          "timestamp": "20231115T00:00:00Z"
        },
        {
          "event": "Park Close - Owners",
          "timestamp": "20231130T00:00:00Z"
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

### 1. Create a new project

```bash
mkdir rdf-server
cd rdf-server
npm i reference-data-framework
npx rdf-init
```

This will create a project with the following structure...

| Name         | Type   | Notes |
|--------------|--------|-------|
| migrations   | folder | Stores the reference data SQL migrations files |
| schemas      | folder | Stores the reference data API json schemas |
| projections  | folder | Stores the reference data API projections |
| index.js     | file   | Starts the RESTful API |
| rdf.json     | file   | Stores the framework [configuration](#configuration) | 

### 2. Create a change set

```bash
npx rdf-create-change-set
```

This will prompt for the following details and create a SQL migration in the `migrations` folder.

| Name           | Type   | Requried | Default                         | Notes |
|----------------|--------|----------|---------------------------------|-------|
| Id             | Number | Yes      | The next number in the sequence | Uniquely identifies a change set, and determines which reference data to use when the `effective from` dates are indentical. | 
| Effective From | String | Yes      |                                 | Must be specified in [ISO 8601 format](https://en.wikipedia.org/wiki/ISO_8601) |
| Notes          | String | No       |                                 | Useful for describing the changes or referencing external documentation        |

### 3. Create a reference data frame

```bash
npx rdf-create-frame
```

This will prompt for the following details and create a placeholder file in the `migrations` folder which must be completed manually.

| Name           | Type   | Required | Default                      | Notes |
|----------------|--------|----------|------------------------------|-------|
| Change Set     | Number | Yes      | The latest change set number | Associates the reference data with a change set, and by implication, an effective from date. | 
| Name           | String | Yes      |                              | The entity name. |
| Version        | Number | Yes      | 1                            | Increment the version ONLY when making backwards incompatible changes. |
| Action         | String | Yes      | PUT                          | The action may be either 'PUT' or 'DELETE'. |
| Notes          | String | No       |                              | Useful for describing the entity or referencing external documentation. |

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

