# Reference Data Framework
A framework for working with time series reference data.

## Contents
- [Introduction](#introduction)
- [How it works](#how-it-works)
- [An example](#an-example)

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
                                                                 Webhook (optional)
                                    ┌──────────────────────────────────────────────────────────────────────────┐
                                    │                                                                          │
                                    │                                                                          ▼
┌─────────────────┐        ┌────────────────┐          GET /rdf/v1/changelog?projection=$p&version=$v  ┌──────────────┐
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

The first of the two API calls, namely `/rdf/v1/changelog` discloses the changes undergone by a projection (a view of the reference data), and provides a set of ids for requesting the projection at a point in time.

```bash
GET /rdf/v1/changelog?projection=park&version=1
```

```json
[
  {
    "changeSetId": 1,
    "effectiveFrom": "2019-01-01T00:00:00.000Z",
    "notes": "Initial park data",
    "lastModified": "2018-12-01T16:20:34.383Z",
    "eTag": "142475a5eddeec8f0786"
  },
  {
     "changeSetId": 2,
     "effectiveFrom": "2020-01-01T00:00:00.000Z",
     "notes": "Park Calendars - 2020",
     "lastModified": "2029-12-01T14:49:34.405Z",
     "eTag": "a3dc15aa8d59d26e349d"
  }
]
```

The second API call, namely `/api/:version/:projection` will return the reference data, correct at the time of the given changeSetId.

```
GET /api/v1/park?changeSetId=2
```

```json
[
  {
    "code": "DC",
    "name": "Devon Hills"
  },
  {
    "code": "GA",
    "name": "Greenacres"
  },
  {
    "code": "PV",
    "name": "Primrose Valley"
  }
]
```

At first glance, accessing projections via change sets may seem an unnecessary overhead, however it provides a number of valuable benefits. 

1. Reference data can be safely prepared/cached ahead of time
2. Clients will receive consistent reference data by fixing the changeSetId at the start of a transaction
3. Clients will receive the latest reference data by updating to the latest changeSetId when one becomes available
4. The changeSetId makes for an excellent cache key, enabling the projection responses to be cached indefinitely
5. Projections provide multiple views of the same reference data, and can therefore be taylored to the needs of each client.
6. Versioned projections supports backwards incompatible changes

Refering back to the previous list of challenges, the above solution can go a long way to solving consistency, load times (tailored content, caching), reliability (caching), stale data, temporality, evolution (through versioning) and local testing (http is easy to nock).

However, even a highly cachable API may still be unreachable, and cumbersome to use with BI tools. By subscribing to the notifications that are emitted per projection when the backing data changes, downstream systems can maintain copies of the data, with reduced risk of it becoming stale. For example, the client in the above diagram could be another backend system, caching proxy, a web application, a websocket application, a CI / CD pipeline responsible for building a client side data module, or an ETL process for exporting the reference data to the company data lake.

## How it works
RDF has the following important concepts
<pre>
                                        ┌────────────────────┐
                                        │                    │
                                        │                    │
                                        │     Projection     │────────────────────────────┐
                                        │                    │                            │
                                        │                    │                            │
                                        └────────────────────┘                            │
                                                   │                                      │
                                                   │ transforms                           │
                                                   │                                      │
                                                   │                                      │
                                                   │                                      │ is monitored by
                                                  ╱│╲                                     │
                                        ┌────────────────────┐                 ┌────────────────────┐
                                        │                    │                 │                    │
                                        │                    │                 │                    │
                                        │       Entity       │                 │      Webhook       │
                                        │                    │                 │                    │
                                        │                    │                 │                    │
                                        └────────────────────┘                 └────────────────────┘
                                                   │                                      │
                                                   │ aggregates                           │ delivers
                                                   │                                      │
                                                   │                                      │
                                                   │                                      │
                                                  ╱│╲                                     │
┌────────────────────┐                  ┌────────────────────┐                 ┌────────────────────┐
│                    │                  │                    │                 │                    │
│                    │ coordinates     ╱│                    │  triggers       │                    │
│     Change Set     │──────────────────│     Data Frame     │─────────────────│    Notification    │
│                    │                 ╲│                    │                 │                    │
│                    │                  │                    │                 │                    │
└────────────────────┘                  └────────────────────┘                 └────────────────────┘

</pre>

### Projections
A projection is a versioned view of one or more **entities**, made available via a RESTful API. The implementor is responsible for writing the the projections, which will mostly be simple database to JSON transformations.

### Entity
An entity represents reference data. It might be a product set, or VAT rates. Entities may be stand alone, or form an object graph. We use a holiday park as an example, in which the park entity has many calendar event entities. If you are familiar with event sourcing, they are implemented as an aggregate of one or more **data frames**. The dependency between projections and entities must be explicitly stated so we can emit notifications when a new **data frame** is added.

### Data Frame
A data frame is a snapshot of an entity, associated with a **change set**. There are two types of data frame, 'PUT' which adds a new snapshot at a point in time, and 'DELETE' which indicates the entity has been deleted. 

### Change Set
A change set groups a set of data frames (potentially for different entities) into a single unit with a common effective date. The data frames will not be aggregated by their parent entities when building a projection for an earlier change set.

### Notifications
Notifications are published whenever a new data frame is created. The framework works out which projections are affected, and notifies interested parties via a **webhook**. If multiple data frames are created in quick succession (or part of a transaction) only a single notification is sent. Notifications are retried a configurable number of times using an exponential backoff algorithm.

### Webhook
A webhook is a URL the framework will POST to whenenver a data frame used to build a projection is added. The body of the request is simply the name and version of the affected projection, and the relevant changet set id.

## An Example
This project includes a proof of concept based on a Caravan Park business. 

```bash
git clone git@github.com:acuminous/reference-data-framework.git
cd reference-data-framework
npm i
npm run docker
node index
```

```
curl -s 'http://localhost:3000/rdf/v1/changelog?projection=park&version=1' | json_pp
```

```json
[
   {
      "changeSetId" : 1,
      "eTag" : "3e47a70d88bc2f469764",
      "effectiveFrom" : "2019-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.782Z",
      "notes" : "Initial park data"
   },
   {
      "changeSetId" : 2,
      "eTag" : "0deb60efb0fdece38ada",
      "effectiveFrom" : "2020-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.806Z",
      "notes" : "Park Calendars - 2020"
   },
   {
      "changeSetId" : 3,
      "eTag" : "0dcca8db71834f0e2157",
      "effectiveFrom" : "2020-02-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.814Z",
      "notes" : "Rename Devon Hills to Devon Cliffs"
   },
   {
      "changeSetId" : 4,
      "eTag" : "147a7c2b260a295eaeb0",
      "effectiveFrom" : "2021-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.817Z",
      "notes" : "Park Calendars - 2021"
   },
   {
      "changeSetId" : 5,
      "eTag" : "6c3955258fad84d85e15",
      "effectiveFrom" : "2021-04-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.825Z",
      "notes" : "Add Richmond"
   },
   {
      "changeSetId" : 6,
      "eTag" : "043b03799009dde539aa",
      "effectiveFrom" : "2021-06-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.830Z",
      "notes" : "Replace Richmond with Skegness"
   },
   {
      "changeSetId" : 7,
      "eTag" : "2077eec54329f6d009b3",
      "effectiveFrom" : "2020-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.836Z",
      "notes" : "Park Calendars - 2022"
   },
   {
      "changeSetId" : 8,
      "eTag" : "e91ee5644302d802278d",
      "effectiveFrom" : "2022-05-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.848Z",
      "notes" : "Delete Greenacres"
   },
   {
      "changeSetId" : 9,
      "eTag" : "c481b71954adc1e6aa1b",
      "effectiveFrom" : "2020-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.850Z",
      "notes" : "Park Calendars - 2023"
   }
]
```

```
curl -s 'http://localhost:3000/api/v1/park?changeSetId=9' | json_pp
```

```json
[
   {
      "calendar" : [
         {
            "event" : "Park Open - Owners",
            "occurs" : "2022-03-01T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Guests",
            "occurs" : "2022-03-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Guests",
            "occurs" : "2022-11-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Owners",
            "occurs" : "2022-11-30T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Owners",
            "occurs" : "2023-03-01T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Guests",
            "occurs" : "2023-03-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Guests",
            "occurs" : "2023-11-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Owners",
            "occurs" : "2023-11-30T00:00:00.000Z"
         }
      ],
      "code" : "DC",
      "name" : "Devon Cliffs"
   },
   {
      "calendar" : [
         {
            "event" : "Park Open - Owners",
            "occurs" : "2022-03-01T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Guests",
            "occurs" : "2022-03-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Guests",
            "occurs" : "2022-11-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Owners",
            "occurs" : "2022-11-30T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Owners",
            "occurs" : "2023-03-01T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Guests",
            "occurs" : "2023-03-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Guests",
            "occurs" : "2023-11-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Owners",
            "occurs" : "2023-11-30T00:00:00.000Z"
         }
      ],
      "code" : "PV",
      "name" : "Primrose Valley"
   },
   {
      "calendar" : [
         {
            "event" : "Park Open - Owners",
            "occurs" : "2022-03-01T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Guests",
            "occurs" : "2022-03-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Guests",
            "occurs" : "2022-11-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Owners",
            "occurs" : "2022-11-30T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Owners",
            "occurs" : "2023-03-01T00:00:00.000Z"
         },
         {
            "event" : "Park Open - Guests",
            "occurs" : "2023-03-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Guests",
            "occurs" : "2023-11-15T00:00:00.000Z"
         },
         {
            "event" : "Park Close - Owners",
            "occurs" : "2023-11-30T00:00:00.000Z"
         }
      ],
      "code" : "SK",
      "name" : "Skegness"
   }
]
```
## Proposed DDL

In it's POC form, RDF requires the developer to manage entity definition and data using SQL migration files. Each entity requires a stored procedure to aggregate the data frames, which results in an undesirable learning curve. Instead we are considering introducing a SQL like domain specific language, which can be used as an alternative to SQL.

```yaml
# 0001.define-park-entities.yaml
define enums
  - name: park_calendar_event_type
    values:
    - Park Open - Owners
    - Park Open - Guests
    - Park Close - Owners
    - Park Close - Guests
define entities: 
  - name: park
    version: 1
    fields:
      - name: code
        type: TEXT
      - name: name
        type: TEXT
    identified by:
      - code
  - name: park_calendar
    version: 1
    fields:
      - name: id
        type: INTEGER
      - name: park_code
        type: TEXT
      - name: event
        type: park_calendar_event_type
      - name: occurs
        type: TIMESTAMP WITH TIME ZONE
    identified by:
      - id
```

```yaml
# 0002.add-park-projection.yaml    
add projections:
  - name: park
    version: 1
    dependencies:
    - name: park
      version: 1
    - name: park_calendar
      version: 1

add webhooks:
  - projection:
      name: park
      version: 1
    url: https://httpbin.org/status/200
```

```yaml
# 0003.add-park-data-frames.yaml
add change set:
  effective_from: 2020-01-01T00:00:00Z
  notes: Park Calendars - 2023
  frames:
    - entity: park
      action: PUT
      data:
        - code: DC
          name: Devon Cliffs
        - code: PV
          name: Primrose Valley
        - code: SK
          name: Skegness
    - entity: park_calendar
      action: PUT
      data:
      - id: 1
        park_code: DC
        event: Park Open - Owners
        occurs: 2023-03-01 00:00:00Z
      - id: 2  
        park_code: DC
        event: Park Open - Guests
        occurs: 2023-03-15 00:00:00Z
      - id: 3
        park_code: DC
        event: Park Close - Owners
        occurs: 2023-11-30 00:00:00Z
      - id: 4
        park_code: DC
        event: Park Close - Guests
        occurs: 2023-11-15 00:00:00Z
      - id: 5
        park_code: PV
        event: Park Open - Owners
        occurs: 2023-03-01 00:00:00Z
      - id: 6
        park_code: PV
        event: Park Open - Guests
        occurs: 2023-03-15 00:00:00Z
      - id: 7
        park_code: PV
        event: Park Close - Owners
        occurs: 2023-11-30 00:00:00Z
      - id: 8
        park_code: PV
        event: Park Close - Guests
        occurs: 2023-11-15 00:00:00Z
      - id: 9
        park_code: SK
        event: Park Open - Owners
        occurs: 2023-03-01 00:00:00Z
      - id: 10
        park_code: SK
        event: Park Open - Guests
        occurs: 2023-03-15 00:00:00Z
      - id: 11
        park_code: SK
        event: Park Close - Owners
        occurs: 2023-11-30 00:00:00Z
      - id: 12
        park_code: SK
        event: Park Close - Guests
        occurs: 2023-11-15 00:00:00Z
```
