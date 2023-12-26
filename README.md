# Reference Data Framework
A framework for working with time series reference data.

## Contents
- [Introduction](#introduction)
- [Concepts](#concepts) 
- [Usage](#usage)
  - [Getting Started](#getting-started)
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
                 │      Time Series       │
                 │     Reference Data     │
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
│                        │                ╲│                        │
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
| Reference&#x00A0;Data | The reference data is slow moving, time series relational data. e.g. Tax rates, Product Catalogs, etc. We use the example of Holiday Park opening times as an example. |
| View | A views is a query across the reference data. |
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
| timestamp | No       | Number | The time in milliseconds to which the reference data should apply. May be disabled by the server. |
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
To create a new project run:

```bash
mkdir refdata-service
cd refdata-service
npm i reference-data-framework --save-dev
npx rdf-init
```

This will create a project with the following structure:

| Name         | Type | Notes |
|--------------|------|-------|
| migrations   | folder | Stores the reference data SQL migrations files |
| schemas      | folder | Stores the reference data API json schemas |
| projections  | folder | Stores the reference data API projections |
| index.js     | file | Starts the RESTful API |
| rdf.json     | file | Stores the framework [configuration](#configuration) | 

### 2. Create a change set
RDF requires all reference data updates to be incorporated into a change set. To create a new change set run:

```bash
npx rdf-create-change-set
```

This will prompt for the following details:

| Name           | Type   | Default | Notes |
|----------------|--------|---------|-------|
| Id             | Number | The next number in the sequence | Uniquely identifies a change set, and determine which reference data to use when the effective from dates are indentical. | 
| Effective from | String |  | Must be specified in [ISO 8601 format](https://en.wikipedia.org/wiki/ISO_8601) |
| Notes          | String |   | useful for describing the changes or referencing external documentation |

and create a SQL migration for the change set in the `migrations` folder.

### 3. Create reference data
To add reference data run:

```bash
npx rdf-create-reference-data
```

This will prompt for the following details: 

| Name           | Type   | Default | Notes |
|----------------|--------|---------|-------|
| Change Set     | Number | The current/highest change set number | Associates the reference data with a change set, and by virtue an effective from date | 
| Name           | String |         | The reference data entity name |
| Version        | Number | 1       | Increment the version when making backwards incompatible changes  |
| Notes          | String |         | useful for describing the changes or referencing external documentation |

The script will also create placeholder files in the `migrations` and `schemas` folders which must be completed manually.

### 4. Expose the reference data via a projection
A projection is a [materialized view](https://www.postgresql.org/docs/current/rules-materializedviews.html), which will be exposed automatically by a RESTful API. To create a new projection run:

```bash
npx rdf-create-projection
```

The will prompt for the following details: 

| Name           | Type   | Default | Notes |
|----------------|--------|---------|-------|
| Name           | String |         | The projection name. Forms part of the RESTful API path |
| Version        | Number | 1       | Increment the version when making backwards incompatible changes. Forms part of the RESTful API path |
| Notes          | String |         | useful for describing the changes or referencing external documentation |

The script will also create placeholder files in the `migrations` and `schemas` folders which must be completed manually. This will automaticaly expose the projection 

### 5. Add a webhook (optional)


## Configuration

| Property             | Type    | Required | Default | Notes |
|----------------------|---------|----------|---------|-------|
| migrations.autostart | Boolean | No       | true    | Applies migrations automatically on startup |

