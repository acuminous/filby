# Filby - A framework for temporal reference data

[![Node.js CI](https://github.com/acuminous/filby/workflows/Node.js%20CI/badge.svg)](https://github.com/acuminous/filby/actions?query=workflow%3A%22Node.js+CI%22)
[![Code Climate](https://codeclimate.com/github/acuminous/filby/badges/gpa.svg)](https://codeclimate.com/github/acuminous/filby)
[![Test Coverage](https://codeclimate.com/github/acuminous/filby/badges/coverage.svg)](https://codeclimate.com/github/acuminous/filby/coverage)
[![Discover zUnit](https://img.shields.io/badge/Discover-zUnit-brightgreen)](https://www.npmjs.com/package/zunit)


*There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.*
<p align="right">-<a href="https://www.amazon.co.uk/Time-Machine-H-G-Wells/dp/1614271976">The Time Machine - H. G. Wells</a></p>

## TL;DR

The easiest way to explain Filby is that it's like source control for reference data. In systems like git, you have a commit log, comprising a sequence of commits. Each commit is uniquely identified by a commit hash, and typically bundles related source code changes (but doesn't have to).<br/>
<br/>
With Filby you have a change log, comprising a sequence of reference data 'change sets'. Each change set is uniquely identified by an id, and typically bundles releated reference data changes (but again, doesn't have to).<br/>
<br/>
Like checking out a commit, your applications can use the Filby API to retrieve a desired set of reference data for a given change set id. You can also inspect the changelog to find which change set was in effect at a given point in time, and be notified when reference data you are interested in receives new updates.

## Contents
- [Introduction](#introduction)
- [How it works](#how-it-works)
- [API](#api)
- [Configuration](#configuration)
- [Example Application](#example-application)

## Introduction
Most applications require slow moving reference data, which presents the following challenges in a distributed / microservice architecture.

| Challenge     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consistency   | Whenever we duplicate our reference data, we increase the likelihood of inconsistency. Even if we have one authoritive source of truth, we may cache the reference data in multiple systems, resulting in temporary inconsisenty unless cache updated are sychronoised. Given the reference data is slow moving, a short period of inconsistency may be acceptable.                                                                                                            |
| Load Times    | Some reference data sets may be too large to desirably load over a network connection for web and mobile applications. Therefore we should discorage accidentlaly including large data sets into a client bundle, or requesting large data sets over a network.                                                                                                                                                                                                                |
| Reliability   | Requesting data sets over a network may fail, especially when mobile. Bundling local copies of reference data into the application (providing they are not too large) will aleviate this, but increase the potential for stale data.                                                                                                                                                                                                                                           |
| Stale Data    | Even though reference data is slow moving, it will still change occasionally. Therefore we need a strategy for refreshing reference data.                                                                                                                                                                                                                                                                                                                                      |
| Temporality   | When reference data changes, the previous values may still be required for historic comparisons. Therefore all reference data should have an effective date. Effective dates can also be used to synchronise updates by including future records when the values are known in advance. This comes at the cost of increased size, and there may still be some inconsistency due to clock drift and cache expiry times.                                                          |
| Evolution     | Both reference data, and our understanding of the application domain evolves over time. We will at some point need to make backwards incompatible changes to our reference data, and will need to do so without breaking client applications. This suggests a versioning and validation mechanism. The issue of temporality compounds the challenge of evolution, since we may need to retrospecively add data to historic records. In some cases this data will not be known. |
| Local Testing | Applications may be tested locally, and therefore any solution sould work well on a development laptop.                                                                                                                                                                                                                                                                                                                                                                        |

Solving such a complex problem becomes simpler when broken down. This project provides a server side framework for managing temporal reference data. In the following diagram, the mechanism for defining, loading, accessing and receiving notifications about reference data are provided by this framework. The RESTful API and Webhook must be manually created by the application developer. An [example application](#example-application) is provided to demonstrate how.

<pre>
                         Change
                      Notification                                Webhook
                      ┌─────────┐   ┌──────────────────────────────────────────────────────────────────┐
                      │         │   │                                                                  │
                      │         ▼   │                                                                  ▼
┌────────┐      ┌───────────┬──────────┐              GET /api/changelog?projection=$p&version=$v ┌──────────┐
│        │      │           │          ├──────────────────────────────────────────────────────────│          │
│        │      │           │          │                                                          │          │
│   DB   │◀────▶│   Filby   │   App    │                                                          │  Client  │
│        │      │           │          │  GET /api/projection/:version/:projection?changeSetId=$c │          │
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

```bash
GET /api/changelog?projection=park&version=1
```

```json
[
  {
    "changeSetId": 1,
    "effective": "2019-01-01T00:00:00.000Z",
    "description": "Initial park data",
    "lastModified": "2018-12-01T16:20:34.383Z",
    "eTag": "142475a5eddeec8f0786"
  },
  {
     "changeSetId": 2,
     "effective": "2020-01-01T00:00:00.000Z",
     "description": "Park Calendars - 2020",
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

1. Reference data can be safely released (and potentially pre-cached) ahead of time
2. Clients can receive consistent reference data by fixing the changeSetId at the start of a transaction
3. Clients can receive the latest reference data by updating to the latest changeSetId when one becomes available
4. The changeSetId makes for an excellent cache key, enabling the projection responses to be cached indefinitely
5. Projections provide multiple views of the same reference data, and can therefore be tailored to the needs of each client.
6. Versioned projections supports backwards incompatible changes

Refering back to the previous list of challenges:

- **Consistency** is solved by the changeSetId mechanic
- **Load Times** and **Reliability** can be greatly reduced because the solution is designed to be highly cacheable. Alternatively keep a local copy of the relevant reference data and using the notification mechanism to update it.
- **Stale Data** can be prevented by deploying reference data ahead of time, checking the changelog for changes and listening for notifications.
- **Historic** data still accessible by using a previous changeSetId
- **Evolution** of reference data is supported by versioned entities and projections
- **Local Testing** is possible through HTTP mocking libraries.

## How it works
filby has the following important concepts
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

### Projections
A projection is a versioned view of one or more **entities**, made available via a RESTful API. The implementor is responsible for writing the the projections, which will mostly be simple database to JSON transformations.

### Entity
An entity represents reference data. It might be a product set, or VAT rates. Entities may be stand alone, or form an object graph. We use a holiday park as an example, in which the park entity has many calendar event entities. If you are familiar with event sourcing, they are implemented as an aggregate of one or more **data frames**. The dependency between projections and entities must be explicitly stated so we can emit notifications when a new **data frame** is added.

### Data Frame
A data frame is a snapshot of an entity, associated with a **change set**. There are two types of data frame, 'POST' which adds a new snapshot at a point in time, and 'DELETE' which indicates the entity has been deleted.

### Change Set
A change set groups a set of data frames (potentially for different entities) into a single unit with a common effective date. The data frames will not be aggregated by their parent entities when building a projection for an earlier change set.

### Notifications
Notifications are published whenever a new data frame is created. By subscribing to the notifications that are emitted per projection when the backing data changes, downstream systems can maintain copies of the data, with reduced risk of it becoming stale. For example, the client in the above diagram could be another backend system, caching proxy, a web application, a websocket application, a CI / CD pipeline responsible for building a client side data module, or an ETL process for exporting the reference data to the company data lake.

Notifications are retried a configurable number of times using an exponential backoff algorithm. It is safe for multiple instances of the framework to poll for notifications concurrently.

### Hook
A hook is an event the framework will emit to whenenver a data frame used to build a projection is added. Your application can handle these events how it chooses, e.g. by making an HTTP request, or publishing a message to an SNS topic. Unlike node events, the handlers can be (and should be) asynchronous. It is advised not to share hooks between handlers since if one handler fails but another succeeds the built in retry mechanism will re-notify both handlers.

## API
filby provides a set of lifecycle methods and an API for retrieving change sets and projections, and for executing database queries (although you are free to use your preferred PostgreSQL client too).

#### filby.init(config: Config): Promise&lt;void&gt;
Connects to the database and runs migrations

#### filby.startNotifications(): Promise&lt;void&gt;
Starts polling the database for notifications

#### filby.stopNotifications(): Promise&lt;void&gt;
Stops polling the database for notifications, and waits for any inflight notifications to complete.

#### filby.stop(): Promise&lt;void&gt;
Stops polling for notifications then disconnects from the database

#### filby.getProjections(): Promise&lt;Projection[]&gt;
Returns the list of projections.

#### filby.getProjection(name: string, version: number): Promise&lt;Projection&gt;
Returns the specified projection.

#### filby.getChangeLog(projection: Projection): Promise&lt;ChangeSet[]&gt;
Returns the change log (an ordered list of change sets) for the given projection.

#### filby.getChangeSet(changeSetId: number): Promise&lt;ChangeSet&gt;
Returns the specified change set

#### filby.getAggregates<T>(changeSetId: number, name: string, version: number): Promise&lt;<T[]>&gt;
Returns aggreated entity data for the specified changeSetId. The sort order will be in order of the entity's identifier fields (ascending, nulls last).

#### filby.withTransaction<T>(callback: (client: PoolClient) => Promise&lt;T&gt;): Promise&lt;T&gt;
Passes a transactional [node-pg client](https://node-postgres.com/) to the given callback. Use this to directly query the aggregate entity data for your projections. The aggregates are accessible via functions with the signature `get_${entity}_v{version}_aggregate(changeSetId INTEGER)`. Entity names will be converted to lowercase and spaces converted to underscores. E.g.

```js
function getParks(changeSetId) {
  return filby.withTransaction(async (client) => {
    const { rows } = await client.query(`
      SELECT p.code, p.name, pc.event AS calendar_event, pc.occurs AS calendar_occurs
      FROM get_park_v1_aggregate($1) p
      LEFT JOIN get_park_calendar_v1_aggregate($1) pc ON pc.park_code = p.code
      ORDER BY p.code ASC, pc.occurs ASC;
    `, [changeSetId]);
    return rows.map(toPark);
  });
};
```


**PRO TIP:** Since the results for the specified change set should not change, consider externalising queries like the above in an immutable PostgreSQL function so the output can be cached.
```sql
-- migrations/0002.create-get-park-v1-function.sql
CREATE FUNCTION get_park_v1(p_change_set_id INTEGER)
RETURNS TABLE (code TEXT, name TEXT, calendar_event park_calendar_event_type, calendar_occurs TIMESTAMP WITH TIME ZONE)
AS $$
BEGIN
  RETURN QUERY
  SELECT p.code, p.name, pc.event AS calendar_event, pc.occurs AS calendar_occurs
  FROM get_park_v1_aggregate(p_change_set_id) p
  LEFT JOIN get_park_calendar_v1_aggregate(p_change_set_id) pc ON pc.park_code = p.code
  ORDER BY p.code ASC, p.occurs ASC;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

## Configuration
All of above objects (Projections, Entities, Data Frames, etc) are defined using a domain specific language, which is dynamically converted into SQL and applied using a database migration tool called [Marv](https://www.npmjs.com/package/marv). Whenever you need to make a update, simply create a new migration file in the `migrations` folder. You can also use the same process for managing SQL changes too (e.g. for adding custom views over the aggregated data frames to make your projections more efficient). The DSL can be expressed in either YAML or JSON.

```yaml
# migrations/0001.define-park-schema.yaml

# add enums for your reference data
# Equivalent of PostgreSQL's CREATE TYPE statement
add enums:
  - name: park_calendar_event_type
    values:
      - Park Open - Owners
      - Park Open - Guests
      - Park Close - Owners
      - Park Close - Guests

# Defining entities performs the following:
#
# 1. Inserts a row into the 'fby_entity' table,
# 2. Creates a table 'park_v1' for holding reference data
# 3. Creates an aggregate function 'park_v1_aggregate' to be used by projections
add entities:
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
# filby uses the dependencies to work out what projections are affected by reference data updates
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
  - description: Initial Data
    effective: 2019-01-01T00:00:00Z
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
        # Adds a data frame that will delete the entity identified
        # by code HF from the effective data
        action: DELETE
        data:
          - code: HF

      # YAML can get verbose, so you can also import data frames from a local CSV
      # action,code,
      # POST,KC,Kent Coast
      # POST,CA,Caistor
      # etc
      - entity: park
        version: 1
        source: ./data/park-data-2019.csv
```

A JSON schema is available in /lib/schema.json

## Example Application
This project includes [proof of concept applications](https://github.com/acuminous/filby/tree/main/examples) based on a Caravan Park business.

### Installation
```bash
git clone git@github.com:acuminous/filby.git
cd filby
npm i
```

### TypeScript variant
```bash
cd examples/typescript
npm i
npm run docker
npm start
```

### JavaScript Variant
```bash
cd examples/javascript
npm i
npm run docker
npm start
```

Once successfully started you should see the following output.

```bash
Server is listening on port 3000
See http://localhost:3000/documentation
Use CTRL+D or kill -TERM 18964 to stop
```

The applications include swagger documentation for the APIs but for a headstart try the following

```bash
GET http://localhost:3000/api/changelog?projection=park&version=1
```

This will return the changelog for the applications 'Park' projection.

```json
[
  {
    "id":1,
    "effective":"2019-01-01T00:00:00.000Z",
    "description":"Initial Data",
    "lastModified":"2024-01-08T07:37:55.415Z",
    "entityTag":"e008f04be41843dd58cb"
  },
  {
    "id":2,
    "effective":"2020-01-01T00:00:00.000Z",
    "description":"Park Calendars - 2020",
    "lastModified":"2024-01-08T07:37:55.434Z",
    "entityTag":"fc32163580c134bec0c0"
  },
  {
    "id":3,
    "effective":"2021-01-01T00:00:00.000Z",
    "description":"Park Calendars - 2021",
    "lastModified":"2024-01-08T07:37:55.444Z",
    "entityTag":"c4240f6bab231fd059e2"
  },
  {
    "id":4,
    "effective":"2021-04-01T00:00:00.000Z",
    "description":"Add Richmond",
    "lastModified":"2024-01-08T07:37:55.458Z",
    "entityTag":"a40672de82626c2518ef"
  },
  {
    "id":5,
    "effective":"2021-06-01T00:00:00.000Z",
    "description":"Rename Richmond to Skegness",
    "lastModified":"2024-01-08T07:37:55.466Z",
    "entityTag":"d9766661224782a96ca6"
  },
  {
    "id":6,
    "effective":"2022-01-01T00:00:00.000Z",
    "description":"Park Calendars - 2022",
    "lastModified":"2024-01-08T07:37:55.476Z",
    "entityTag":"841b9acde0c757decc20"
  },
  {
    "id":7,
    "effective":"2022-05-01T00:00:00.000Z",
    "description":"Delete Greenacres",
    "lastModified":"2024-01-08T07:37:55.489Z",
    "entityTag":"56aae19316c7eed13adb"
  },
  {
    "id":8,
    "effective":"2023-01-01T00:00:00.000Z",
    "description":"Park Calendars - 2023",
    "lastModified":"2024-01-08T07:37:55.495Z",
    "entityTag":"25c02cea536038f310e7"
  }
]
```

Now pick a change set id and request the Park data at that point in time...

```bash
GET http://localhost:3000/api/projection/v1/park?changeSetId=1
```

```json
[
  {
    "code":"DC",
    "name":"Devon Cliffs",
    "calendar":[
      {
        "event":"Park Open - Owners",
        "occurs":"2019-03-01T00:00:00.000Z"
      },
      {
        "event":"Park Open - Guests",
        "occurs":"2019-03-15T00:00:00.000Z"
      },
      {
        "event":"Park Close - Guests",
        "occurs":"2019-11-15T00:00:00.000Z"
      },
      {
        "event":"Park Close - Owners",
        "occurs":"2019-11-30T00:00:00.000Z"
      }
    ]
  },
  {
    "code":"GA",
    "name":"Greenacres",
    "calendar":[
      {
        "event":"Park Open - Owners",
        "occurs":"2019-03-01T00:00:00.000Z"
      },
      {
        "event":"Park Open - Guests",
        "occurs":"2019-03-15T00:00:00.000Z"
      },
      {
        "event":"Park Close - Guests",
        "occurs":"2019-11-15T00:00:00.000Z"
      },
      {
        "event":"Park Close - Owners",
        "occurs":"2019-11-30T00:00:00.000Z"
      }
    ]
  },
  {
    "code":"PV",
    "name":"Primrose Valley",
    "calendar":[
      {
        "event":"Park Open - Owners",
        "occurs":"2019-03-01T00:00:00.000Z"
      },
      {
        "event":"Park Open - Guests",
        "occurs":"2019-03-15T00:00:00.000Z"
      },
      {
        "event":"Park Close - Guests",
        "occurs":"2019-11-15T00:00:00.000Z"
      },
      {
        "event":"Park Close - Owners",
        "occurs":"2019-11-30T00:00:00.000Z"
      }
    ]
  }
]
```
