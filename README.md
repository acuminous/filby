# Filby - A framework for temporal reference data

[![NPM version](https://img.shields.io/npm/v/filby.svg?style=flat-square)](https://www.npmjs.com/package/filby)
[![Node.js CI](https://github.com/acuminous/filby/workflows/Node.js%20CI/badge.svg)](https://github.com/acuminous/filby/actions?query=workflow%3A%22Node.js+CI%22)
[![Code Climate](https://codeclimate.com/github/acuminous/filby/badges/gpa.svg)](https://codeclimate.com/github/acuminous/filby)
[![Test Coverage](https://codeclimate.com/github/acuminous/filby/badges/coverage.svg)](https://codeclimate.com/github/acuminous/filby/coverage)
[![Discover zUnit](https://img.shields.io/badge/Discover-zUnit-brightgreen)](https://www.npmjs.com/package/zunit)

*There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.*
<p align="right">-<a href="https://www.amazon.co.uk/Time-Machine-H-G-Wells/dp/1614271976">The Time Machine - H. G. Wells</a></p>

## TL;DR

The easiest way to explain Filby is that it's like source control for reference data. 

- In systems like git, you have a **commit log**, comprising a sequence of **commits**. Each commit is uniquely identified by a **commit hash**, and typically bundles related **source code** changes. <br/><br/>
- With Filby, you have a **change log**, comprising a sequence of **change sets**. Each change set is uniquely identified by a **change set id**, and typically bundles related **reference data** changes.

Like checking out a commit, your applications can use Filby to retrieve reference data for a given change set id. They can also inspect the changelog to find which change set was in effect at a given point in time, and subscribe to reference data change notifications.

## Contents
- [Introduction](#introduction)
- [Benefits](#benefits)
- [Concepts](#concepts)
- [API](#api)
- [Data Definition](#data-definition)
- [Configuration](#configuration)
- [Example Application](#example-application)

## Introduction
Most applications require slow moving reference data, which presents the following challenges in a distributed / microservice architecture.

| Challenge     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consistency   | Whenever we duplicate our reference data, we increase the likelihood of inconsistency. Even if we have one authoritive source of truth, we may cache the reference data in multiple systems, resulting in temporary inconsisenty unless cache updates are sychronised. Given the reference data is slow moving, a short period of inconsistency may be acceptable.                                                                                                             |
| Load Times    | Some reference data sets may be too large to desirably load over a network connection for web and mobile applications. Therefore we should discourage accidentally including large data sets into a client bundle, or requesting large data sets over a network.                                                                                                                                                                                                               |
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
│        │      │           │ Example  │                                                          │          │
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

```
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

The example applications include a convenience feature where if the changeSetId is omitted, the client will be redirected to projection at the current change set.

```
GET /api/projection/v1/park
```

```
HTTP/1.1 307 Temporary Redirect
location: /api/projection/v1/park?changeSetId=8
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

### Projections
A *Projection* is a versioned view of one or more *Entities*, made available in the example application via a RESTful API. The implementor is responsible for writing the the projections, which will mostly be simple database to JSON transformations.

### Entity
An *Entity* represents reference data. Entities may be stand alone, or form an object graph. We use a holiday park as an example, in which the park entity has many calendar event entities. If you are familiar with event sourcing, they are implemented as an aggregate of one or more *Data Frames*. The dependency between projections and entities must be explicitly stated so we can emit *Notifications* when a new data frame is added.

### Data Frame
A *Data Frame* is a snapshot of an entity, associated with a *Change Set*. There are two types of data frame, 'POST' which adds a new snapshot at a point in time, and 'DELETE' which indicates the entity has been deleted.

### Change Set
A *Change Set* groups a set of data frames (potentially for different entities) into a single unit with a common effective date. The data frames will not be aggregated by their parent entities when building a projection for an earlier change set.

### Notifications
*Notifications* are published whenever a new data frame is created. By subscribing to the notifications that are emitted per projection when the backing data changes, downstream systems can maintain copies of the data, with reduced risk of it becoming stale. For example, the client in the above diagram could be another backend system, caching proxy, a web application, a websocket application, a CI / CD pipeline responsible for building a client side data module, or an ETL process for exporting the reference data to the company data lake.

Notifications are retried a configurable number of times using an exponential backoff algorithm. It is safe for multiple instances of the framework to poll for notifications concurrently.

### Hook
A *Hook* is an event the framework will emit to whenenver a projection is added, dropped or updated via a change set. Your application can handle these events how it chooses, e.g. by making an HTTP request, or publishing a message to an SNS topic. Unlike node events, the handlers are asynchronous. It is advised not to share hooks between handlers since if one handler fails but another succeeds the built in retry mechanism will re-notify both handlers.

## API
Filby provides a set of lifecycle methods and an API for retrieving change sets and projections, and for executing database queries (although you are free to use your preferred PostgreSQL client too).

#### new Filby(config: Config)
Constructs a new Filby instance

#### filby.init(): Promise&lt;void&gt;
Connects to the database and runs migrations

#### filby.stop(): Promise&lt;void&gt;
Stops polling for notifications then disconnects from the database

#### filby.startNotifications(): Promise&lt;void&gt;
Starts polling the database for notifications

#### filby.stopNotifications(): Promise&lt;void&gt;
Stops polling the database for notifications, and waits for any inflight notifications to complete.

#### filby.subscribe&lt;T&gt;(event: string, handler: (notification: T) => Promise&lt;void&gt;): void
Under the hood, Filby uses [eventemitter2](https://www.npmjs.com/package/eventemitter2) which unlike node's EventEmitter, supports asynchronous events. You can use these to listen for hooks and perform of asynchronous tasks like making an HTTP request for a webhook. The hook name is user defined and must be specified in the Hook [Data Definition](#data-definition). The sole callback parameter is the Notification context (see the TypeScript definitions), e.g.

```js
filby.subscribe('VAT Rate changed', async (notification) => {
  await axios.post('https://httpbin.org/status/200', notification);
});
```

If your event handler throws an exception it will be caught by Filby and the notifiation retried up to a maximum number of times, with an incremental backoff delay. If the maximum attempts are exceeded then Filby emits dedicated hook, `Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED`. The sole callback parameter is the ErrorNotification context (see the TypeScript definitions), e.g.

```js
filby.subscribe(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, (notification) => {
  console.error('Hook Failed', notification);
  console.error('Hook Failed', notification.err.stack); // Careful not to log secrets that may be on the error
});
```

#### filby.unsubscribe&lt;T&gt;(event: string, handler?: (notification: T) => Promise&lt;void&gt;): void
Unsubscribes the specified handler, or all handlers if none is specified, from the specified event

#### filby.unsubscribeAll(): void
Unsubscribes all handlers from all events

#### filby.getProjections(): Promise&lt;Projection[]&gt;
Returns the list of projections.

#### filby.getProjection(name: string, version: number): Promise&lt;Projection&gt;
Returns the specified projection.

#### filby.getChangeLog(projection: Projection): Promise&lt;ChangeSet[]&gt;
Returns the change log (an ordered list of change sets) for the given projection.

#### filby.getCurrentChangeSet(projection: Projection): Promise&lt;ChangeSet&gt;
Returns the current changeset for the given projection based on the database's current time.

#### filby.getChangeSet(changeSetId: number): Promise&lt;ChangeSet&gt;
Returns the specified change set

#### filby.getAggregates&lt;T&gt;(changeSetId: number, name: string, version: number): Promise&lt;T[]&gt;
Returns aggreated entity data for the specified changeSetId. The sort order will be in order of the entity's identifier fields (ascending, nulls last).

```js
async function getParks(changeSetId) {
  const rows = await filby.getAggregates(changeSetId, 'Park', 1);
  return rows.map(toParkStructure);
};
```

#### filby.withTransaction&lt;T&gt;(callback: (client: PoolClient) => Promise&lt;T&gt;): Promise&lt;T&gt;
Passes a transactional [node-pg client](https://node-postgres.com/) to the given callback. Use this to directly query the aggregate entity data for your projections. The aggregates are accessible via functions with the signature `get_${entity}_v{version}_aggregate(changeSetId INTEGER)`. Entity names will be converted to lowercase and spaces converted to underscores. E.g.

```js
async function getParks(changeSetId) {
  return filby.withTransaction(async (client) => {
    const { rows } = await client.query(`
      SELECT p.code, p.name, pc.event AS calendar_event, pc.occurs AS calendar_occurs
      FROM get_park_v1_aggregate($1) p
      LEFT JOIN get_park_calendar_v1_aggregate($1) pc ON pc.park_code = p.code
      ORDER BY p.code ASC, pc.occurs ASC;
    `, [changeSetId]);
    return rows.map(toParkStructure);
  });
};
```

**PRO TIP**: Since the results for the specified change set should not change, consider externalising queries like the above in an immutable PostgreSQL function so the output can be cached.
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

## Data Definition
All of above objects (Projections, Entities, Data Frames, etc) are defined using a domain specific language, which is dynamically converted into SQL and applied using a database migration tool called [Marv](https://www.npmjs.com/package/marv). Whenever you need to make a update, simply create a new migration file in the `migrations` folder containing a suitably configured `.marvrc` file, e.g.
```json
{
  "filter": "(?:\\.sql|\\.yaml|\\.json)$"
}
```
You can also use the same process for managing SQL changes too (e.g. for adding custom views over the aggregated data frames to make your projections more efficient). The DSL can be expressed in either YAML or JSON. A JSON schema is available in /lib/schema.json

```yaml
# migrations/0001.define-park-schema.yaml

# Add enums for your reference data
# Equivalent of PostgreSQL's CREATE TYPE statement
- operation: ADD_ENUM
  name: park_calendar_event_type
  values:
    - Park Open - Owners
    - Park Open - Guests
    - Park Close - Owners
    - Park Close - Guests

# Adding entities performs the following:
# 1. Inserts a row into the 'fby_entity' table,
# 2. Creates a table 'park_v1' for holding reference data
# 3. Creates an aggregate function 'get_park_v1_aggregate' to be used by projections
- operation: ADD_ENTITY
  name: park
  version: 1
  fields:
    - name: code
      type: TEXT # Any valid PostgreSQL type (including enums) are supported
    - name: name
      type: TEXT
  identified_by:
    - code # Used to aggregate the data frames

  # Creates PostgreSQL check constraints
  # This must be explicitly enabled in config since they introduce the potential for SQL Injection
  checks:
    park_code_len: LENGTH(code) >= 2

# Defining projections and their dependent entities
# Filby uses the dependencies to work out what projections are affected by reference data updates
- operation: ADD_PROJECTION
  name: parks
  version: 1
  dependencies:
    - name: park
      version: 1
    - name: calendar_event
      version: 1

# A hook defines an asynchronous event that will be emitted by the framework whenever the
# reference data the projection changes.

# This is a projection specific hook which fires when the data
# supporting the specified projection changes
- operation: ADD_HOOK
  name: sns/add-change-set/parks-v1 # Must be unique
  event: ADD_CHANGE_SET
  projection: Parks
  version: 1

# This is a general hook that fires when the data
# supporting any projection changes
- operation: ADD_HOOK
  name: data-lake/add-change-set/* # Must be unique
  event: ADD_CHANGE_SET
```

```yaml
# migrations/0002.initial-data-load.yaml

# Add a change set containing one or more data frames for the previously defined entities
- operation: ADD_CHANGE_SET
  description: Initial Data
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
      # The CSV requires a header row, starting with the action column and
      # followed by the column names of your entity. When deleting data you
      # only need to include the fields that identify the entity
    - entity: park
      version: 1
      source: ./data/park-data-2019.csv
      # action,code,name
      # POST,KC,Kent Coast
      # POST,CA,Caistor
      # DELETE,TP,
```

```yaml
# migrations/0003.drop-unused-objects.yaml

# Deletes the specified enum
# Fails if the enums are still use
- operation: DROP_ENUM
  name: park_calendar_event_type

# Deletes the specified entity and associated data frames
# Fails if the entities are still depended on by projections
- operation: DROP_ENTITY
  name: park
  version: 1

# Deletes the specified projection and associated hooks
# Fails if the entities are still depended on by projections
- operation: DROP_PROJECTION
  name: parks
  version: 1

# Deletes the specified hook and associated notifications
- operation: DROP_HOOK
  name: sns/add-change-set/park-v1
```

## Configuration
```js
{
  "dsl": {
    // Enables PostgreSQL check constraints (defaults to false).
    // Check constraints carry an inherent risk of SQL injection since the expression cannot be escaped or validated
    "enableCheckConstraints": true
  }

  // All the database configuration is passed through to https://www.npmjs.com/package/pg
  "database": {
    "user": "fby_example",
    "database": "fby_example",
    "password": "fby_example"
  },

  "migrations": {
    // Specifies the path to the migrations folder. Defaults to "migrations"
    "directory": "path/to/migrations/folder"
  },

  "notifications": {

    // The frequency Filby will check for new notifications
    // Defaults to 1 minute
    "interval": "5s",

    // The initial delay before Filby starts checking for notifications
    // (you still have to call filby.startNotifications)
    // Defaults to 10s
    "intialDelay": "1s",

    // THe maximum number of times Filby will attempt to deliver a hook
    // Defaults to 10
    "maxAttempts": 20,

    // The maximum amount of time Filby will wait before retrying a failed hook
    // Defaults to 1 hour
    "maxRescheduleDelay": "30s"
  }
}
```

## Example Application
This project includes [proof of concept applications](https://github.com/acuminous/filby/tree/main/examples) based on a Caravan Park business.

### Installation
```bash
git clone git@github.com:acuminous/filby.git
cd filby
npm i
npm run docker
```

### TypeScript variant
```bash
cd examples/typescript
npm i
npm start
```

### JavaScript Variant
```bash
cd examples/javascript
npm i
npm start
```

Once successfully started you should see the following output.

```
Server is listening on port 3000
See http://localhost:3000/documentation
Use CTRL+D or kill -TERM 18964 to stop
```

The applications include swagger documentation for the APIs but for a headstart try the following

```
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

```
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
