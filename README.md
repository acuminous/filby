# Reference Data Framework
A framework for working with slow moving, time dependent reference data.

## Contents
- [Introduction](#introduction)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Example Application](#example-application)

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

Solving such a complex problem becomes simpler when broken down. This project provides a server side framework for managing slow moving, time dependent reference data. In the following diagram, the mechanism for defining, loading, accessing and receiving notifications about reference data are provided by this framework. The RESTful API and Webhook must be manually created by the application developer. An [example application](#example-application) is provided to demonstrate how.

<pre>
                             Change
                          Notification                                   Webhook
                         ┌───────────┐    ┌────────────────────────────────────────────────────────────────────┐
                         │           │    │                                                                    │
                         │           ▼    │                                                                    ▼
┌────────┐      ┌─────────────────┬──────────┐              GET /api/changelog?projection=$p&version=$v ┌──────────────┐
│        │      │                 │          ├──────────────────────────────────────────────────────────│              │
│        │      │    Reference    │          │                                                          │              │
│   DB   │◀────▶│      Data       │   App    │                                                          │    Client    │
│        │      │    Framework    │          │  GET /api/projection/:version/:projection?changeSetId=$c │              │
│        │      │                 │          ├──────────────────────────────────────────────────────────│              │
└────────┘      └─────────────────┴──────────┘                                                          └──────────────┘
                         ▲
                         │
                         │
            ┌────────────────────────┐
            │                        │
            │     Reference Data     │
            │      Change Sets       │
            │                        │
            └────────────────────────┘
</pre>

The first of the two API calls, namely `/api/changelog` discloses the changes undergone by a projection (a view of the reference data), and provides a set of ids for requesting the projection at a point in time.

```bash
GET /api/changelog?projection=park&version=1
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

The second API call, namely `/api/projection/:version/:projection` will return the reference data, correct at the time of the given changeSetId.

```
GET /api/projection/v1/park?changeSetId=2
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
                                        │       Entity       │                 │        Hook        │
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
A data frame is a snapshot of an entity, associated with a **change set**. There are two types of data frame, 'POST' which adds a new snapshot at a point in time, and 'DELETE' which indicates the entity has been deleted.

### Change Set
A change set groups a set of data frames (potentially for different entities) into a single unit with a common effective date. The data frames will not be aggregated by their parent entities when building a projection for an earlier change set.

### Notifications
Notifications are published whenever a new data frame is created. The framework works out which projections are affected, and notifies interested parties via a **hook**. If multiple data frames are created in quick succession (or part of a transaction) only a single notification is sent. Notifications are retried a configurable number of times using an exponential backoff algorithm.

### Hook
A hook is an event the framework will emit to whenenver a data frame used to build a projection is added. Your application can handle these events how it chooses, e.g. by making an HTTP request, or publishing a message to an SNS topic. Unlike node events, the handlers can be (and should be) asynchronous. It is advised not to share hooks between handlers since if one handler fails but another succeeds the built in retry mechanism will re-notify both handlers.

## Configuration
All of above objects (Projections, Entities, Data Frames, etc) are defined using a domain specific language, which is dynamically converted into SQL and applied using a database migration tool called [Marv](https://www.npmjs.com/package/marv). Whenever you need to make a update, simply create a new migration file in the `migrations` folder. You can also use the same process for managing SQL changes too (e.g. for adding custom views over the aggregated data frames to make your projections more efficient). The DSL can be expressed in either YAML or JSON.

```yaml
# migrations/0001.define-park-schema.yaml

# Define enums for your reference data
# Equivalent of PostgreSQL's CREATE TYPE statement
define enums:

  - name: park_calendar_event_type
    values:
      - Park Open - Owners
      - Park Open - Guests
      - Park Close - Owners
      - Park Close - Guests

# Defining entities performs the following:
#
# 1. Inserts a row into the 'rdf_entity' table,
# 2. Creates a table 'park_v1' for holding reference data
# 3. Creates an aggregate function 'park_v1_aggregate' to be used by projections
#
define entities:

  - name: park
    version: 1
    fields:
      - name: code
        type: TEXT # Any valid PostgreSQL type (including enums) are supported
      - name: name
        type: TEXT
    identified by:
      - code # Used to aggregate the data frames
    checks:
      park_code_len: LENGTH(code) >= 2 # Creates PostgreSQL check constraints

# Defining projections and their dependent entities
# RDF uses the dependencies to work out what projections are affected by reference data updates
add projections:
  - name: park
    version: 1
    dependencies:
    - name: park
      version: 1
    - name: calendar
      version: 1

# A hook defines an asynchronous event that will be emitted by the framework whenever the
# reference data the projection changes.
add hooks:
  # This is a projection specific hook, which only fires when the data
  # supporting the park v1 projection changes
  - projection: park
    version: 1
    event: park_v1_change
  # This is a general hook, which only fires when the data
  # supporting any projection changes
  - event: change
```

```yaml
# migrations/0002.initial-data-load.yaml

# Add a change set containing one or more data frames for the previously defined entities
add change set:
  effective_from: 2019-01-01T00:00:00Z
  notes: Initial Data
  frames:
    - entity: park
      version: 1
      action: POST
      data:
        # Adds a data frame for Devon Cliffs
        - code: DC
          name: Devon Cliffs
        # Adds a data frame for Primrose Valley
        - code: PV
          name: Primrose Valley
    - entity: park
      version: 1
      action: DELETE
      data:
        # Adds a data frame that will delete the entity identified
        # by code XX from the effective data
        - code: XX
```

## Example Application
This project includes a proof of concept based on a Caravan Park business. 

```bash
git clone git@github.com:acuminous/reference-data-framework.git
cd reference-data-framework
npm i
cd example
npm i
npm run docker
node index
```

```
curl -s 'http://localhost:3000/api/changelog?projection=park&version=1' | json_pp
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
      "eTag" : "147a7c2b260a295eaeb0",
      "effectiveFrom" : "2021-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.817Z",
      "notes" : "Park Calendars - 2021"
   },
   {
      "changeSetId" : 4,
      "eTag" : "6c3955258fad84d85e15",
      "effectiveFrom" : "2021-04-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.825Z",
      "notes" : "Add Richmond"
   },
   {
      "changeSetId" : 5,
      "eTag" : "043b03799009dde539aa",
      "effectiveFrom" : "2021-06-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.830Z",
      "notes" : "Rename Richmond to Skegness"
   },
   {
      "changeSetId" : 6,
      "eTag" : "2077eec54329f6d009b3",
      "effectiveFrom" : "2020-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.836Z",
      "notes" : "Park Calendars - 2022"
   },
   {
      "changeSetId" : 7,
      "eTag" : "e91ee5644302d802278d",
      "effectiveFrom" : "2022-05-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.848Z",
      "notes" : "Delete Greenacres"
   },
   {
      "changeSetId" : 8,
      "eTag" : "c481b71954adc1e6aa1b",
      "effectiveFrom" : "2020-01-01T00:00:00.000Z",
      "lastModified" : "2023-12-30T12:15:10.850Z",
      "notes" : "Park Calendars - 2023"
   }
]
```

```
curl -s 'http://localhost:3000/api/projection/v1/park?changeSetId=8' | json_pp
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

