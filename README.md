# Reference Data Framework
A framework for managing time series reference data. Features include

- Supports time series reference data
- Selectively expose reference data via a RESTful API
- Notify downstream systems of changes via webhooks

Requires a PostgreSQL database

## Concepts

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
                                           ┌────────────────────────┐               ┌────────────────────────┐
                                           │                        │               │                        │
                                           │                        │   triggers   ╱│                        │ POST $url
                                           │          View          │┼──────────────│        Webhook         │─────────────▶
                                           │                        │              ╲│                        │
                                           │                        │               │                        │
                                           └────────────────────────┘               └────────────────────────┘
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
                                                        ┼
                                                        │
                                                        │ is exposed by
                                                        │
                                                        │
                                                       ╱│╲
                                           ┌────────────────────────┐             GET /api/$version/$entity/at
                                           │                        │◀────────────────────────────────────────
                                           │                        │           GET /api/$version/$entity/from
                                           │      RESTful API       │◀────────────────────────────────────────
                                           │                        │            GET /api/$version/$entity/all
                                           │                        │◀────────────────────────────────────────
                                           └────────────────────────┘
</pre>

### Change Set
A change set determines which reference data is in effect at a given point in time.

### Reference Data
The reference data is slow moving, time series relational data. e.g. Tax rates, Product Catalogs, etc.

### View
Views query the reference data. RDF implements them using [materialised views](https://www.postgresql.org/docs/current/rules-materializedviews.html).

### Projection
A projection transforms a view, typically into a structured JSON object. 

### RESTful API
Each projection is automatically exposed via three RESTful APIs.

#### GET /api/$version/$projection/at
Exposes the projected reference data at the given point in time

| Parameter | Required | Type   | Notes |
|-----------|----------|--------|-------|
| timestamp | Yes      | String | Must be specified in [ISO 8601 format](https://en.wikipedia.org/wiki/ISO_8601) |
| offset    | No       | Number | For pagination |
| limit     | No       | Number | For pagination |

##### Example
```
GET /api/v1/park/at?ts=20230710T20:15:33Z
```

```json
{
  "data": [
    {
      "code": "DC",
      "name": "Devon Cliffs",
      "calendar": [
        {
          "eventType": "Park Open - Owners",
          "timestamp": "20230301T00:00:00",
        },
        {
          "eventType": "Park Open - Guests",
          "timestamp": "20230314T00:00:00",
        },
        {
          "eventType": "Park Close - Guests",
          "timestamp": "20231115T00:00:00",
        },
        {
          "eventType": "Park Close - Owners",
          "timestamp": "20231130T00:00:00",
        }
      ],
    },
    {
      "code": "PV",
      "name": "Primrose Valley",
      "calendar": [
        {
          "eventType": "Park Open - Owners",
          "timestamp": "20230301T00:00:00",
        },
        {
          "eventType": "Park Open - Guests",
          "timestamp": "20230314T00:00:00",
        },
        {
          "eventType": "Park Close - Guests",
          "timestamp": "20231115T00:00:00",
        },
        {
          "eventType": "Park Close - Owners",
          "timestamp": "20231130T00:00:00",
        }
      ],
    }
  ],
  "metadata": {
    "offset": 1,
    "limit": 10,
    "documents": 39
  }
}
```

#### GET /api/$version/$projection/from
Exposes the projected reference data **from** the given point in time (inclusive). Use this when you want to cache future changes. Because multiple versions of the same reference data may returned, the data is presented in time series format. Use the RDK client to parse the response more easily.

| Parameter | Required | Type   | Notes |
|-----------|----------|--------|-------|
| timestamp | Yes      | String | Must be specified in [ISO 8601 format](https://en.wikipedia.org/wiki/ISO_8601) |
| offset    | No       | Number | For pagination |
| limit     | No       | Number | For pagination |

##### Example
```
GET /api/v1/park/from?ts=20230710T20:15:33Z
```

```json
{
  "data": [
    {
      "code": [
        {
          "value": "DC"
        }
      ],
      "name": [
        {
          "value": "Devon Cliffs"
        },
        {
          "value": "Devon Hills",
          "from": "20240101T00:00:00Z"
        },
        {
          "from": "20250101T00:00:00Z"
        }
      ],
      "calendar": [
        [
          {
            "value": {
              "eventType": [
                { "value": "Park Open - Owners" },
              ],
              "timestamp": [
                { "value": "20230301T00:00:00" },
              ]
            },
          },
          {
            "value": { 
              "eventType": [
                { "value": "Park Open - Owners" },
              ],
              "timestamp": [
                { "value": "20230301T00:00:00" },
              ]
            },
            "from": "20240101T00:00:00Z",
          },
        ],
        {
          "eventType": "Park Open - Guests",
          "timestamp": "20230314T00:00:00",
        },
        {
          "eventType": "Park Close - Guests",
          "timestamp": "20231115T00:00:00",
        },
        {
          "eventType": "Park Close - Owners",
          "timestamp": "20231130T00:00:00",
        }
      ],
    },
    {
      "code": "PV",
      "name": "Primrose Valley",
      "calendar": [
        {
          "eventType": "Park Open - Owners",
          "timestamp": "20230301T00:00:00",
        },
        {
          "eventType": "Park Open - Guests",
          "timestamp": "20230314T00:00:00",
        },
        {
          "eventType": "Park Close - Guests",
          "timestamp": "20231115T00:00:00",
        },
        {
          "eventType": "Park Close - Owners",
          "timestamp": "20231130T00:00:00",
        }
      ],
    }
  ],
  "metadata": {
    "offset": 1,
    "limit": 10,
    "documents": 39
  }
}
```

#### GET /api/$version/$projection/all
Exposes all the projected reference data

| Parameter | Required | Type   | Notes |
|-----------|----------|--------|-------|
| offset    | No       | Number | For pagination |
| limit     | No       | Number | For pagination |

- Example Responses
- Error codes
- Configuration (Max Page Size)

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

