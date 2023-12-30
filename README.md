# Reference Data Framework
A framework for working with time series reference data.

## Contents
- [Introduction](#introduction)
- [How it works](#how-it-works)
- [An example](#an-example)
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
The following example is based on a Caravan Park business. The first step is to start a new project

```bash
mkdir my-holiday-park
cd my-holiday-park
npm init
npm i reference-data-framework
npx rdk-init
```

The main type of reference data is a `Park`. Each park as a unique, two character `code` and a `name`. Each park also has a calendar of events to indicate when it is open / closed for Owners (people who own caravans) and Guests (people who let caravans). A structured JSON document representing this data might look like...

```json
{
  "code": "DC",
  "name": "Devon Cliffs",
  "calendar": [
    {
      "id": 1,
      "event": "Park Open - Owners",
      "occurs": "2023-03-01T00:00:00Z"
    },
    {
      "id": 2,
      "event": "Park Open - Guests",
      "occurs": "2023-03-15T00:00:00Z"
    },
    {
      "id": 3,
      "event": "Park Close - Guests",
      "occurs": "2023-11-15T00:00:00Z"
    },
    {
      "id": 4,
      "event": "Park Close - Owners",
      "occurs": "2023-11-30T00:00:00Z"
    }
  ]
}
```

We have to break this structure down into two relational database tables. We will version the tables in case we need to make backwards compatible changes in future. They will also need to reference the data frame table and have one additional identity column. The other columns should be nullable, and because we may have multiple rows for the same entity over time, none of the fields other than the data frame reference should be unique.

```sql
START TRANSACTION;

CREATE TABLE park_v1 (
  rdf_frame_id INTEGER PRIMARY KEY REFERENCES rdf_data_frame (id),
  code TEXT NOT NULL,  -- identity column
  name TEXT
);

CREATE table park_calendar_v1 (
  rdf_frame_id INTEGER PRIMARY KEY REFERENCES rdf_data_frame (id),
  id INTEGER NOT NULL, -- identity column
  park_code TEXT,
  event TEXT,
  occurs TIMESTAMP WITH TIME ZONE
);

END TRANSACTION;
```
Take this snippet and paste it into a file called `migrations/001.park-structure.sql`.

Unfortunately the next step is more complicated. We need to aggregate these tables for a given change set id, so we're going to write two stored procedures to do just that. They're pretty horrible to look at so bear with me.

```sql
START TRANSACTION;

CREATE FUNCTION get_squashed_park_v1(p_change_set_id INTEGER) RETURNS TABLE (
  rdf_action rdf_action_type,
  code TEXT,
  name TEXT
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DISTINCT ON (code)
    f.action AS rdf_action,
    p.code,
    p.name
  FROM 
    rdf_data_frame f
  INNER JOIN rdf_entity e ON e.id = f.entity_id
  INNER JOIN park_v1 p ON p.rdf_frame_id = f.id
  WHERE e.name = 'park' AND e.version = 1 AND f.change_set_id <= p_change_set_id
  ORDER BY
    p.code ASC, 
    p.rdf_frame_id DESC;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_squashed_park_calendar_v1(p_change_set_id INTEGER) RETURNS TABLE (
  rdf_action rdf_action_type,
  id INTEGER,  
  park_code TEXT,
  event TEXT,
  occurs TIMESTAMP WITH TIME ZONE
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DISTINCT ON (pc.id)
    f.action AS rdf_action,
    pc.id,
    pc.park_code,
    pc.event,
    pc.occurs
  FROM 
    rdf_data_frame f
  INNER JOIN rdf_entity e ON e.id = f.entity_id
  INNER JOIN park_calendar_v1 pc ON pc.rdf_frame_id = f.id
  WHERE e.name = 'park_calendar' AND e.version = 1 AND f.change_set_id <= p_change_set_id
  ORDER BY
    pc.id,
    pc.rdf_frame_id DESC;
END;
$$ LANGUAGE plpgsql;

END TRANSACTION;
```
We will use the functions whenever we need the Park and Park Calendar data for a projection. Copy the above SQL and save it in a `migrations/002.aggregation-functions.sql

Next we are going to write a couple of functions to simply the process of adding data frames.

```sql
CREATE FUNCTION put_park_v1(p_change_set_id INTEGER, p_code TEXT, p_name TEXT) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'PUT') INTO v_frame_id;
  INSERT INTO park_v1 (rdf_frame_id, code, name) VALUES (v_frame_id, p_code, p_name);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION delete_park_v1(p_change_set_id INTEGER, p_code TEXT) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'DELETE') INTO v_frame_id;
  INSERT INTO park_v1 (rdf_frame_id, code) VALUES (v_frame_id, p_code);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION put_park_calendar_v1(p_change_set_id INTEGER, p_id INTEGER, p_park_code TEXT, p_event TEXT, p_occurs TIMESTAMP WITH TIME ZONE) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park_calendar';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'PUT') INTO v_frame_id;
  INSERT INTO park_calendar_v1 (rdf_frame_id, id, park_code, event, occurs) VALUES (v_frame_id, p_id, p_park_code, p_event, p_occurs);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION delete_park_calendar_v1(p_change_set_id INTEGER, p_id INTEGER) RETURNS VOID
AS $$
DECLARE
  c_entity_name TEXT := 'park_calendar';
  c_entity_version INTEGER := 1;
  v_entity_id INTEGER;  
  v_frame_id INTEGER;
BEGIN
  SELECT id INTO v_entity_id FROM rdf_entity WHERE name = c_entity_name AND version = c_entity_version;
  SELECT rdf_add_data_frame(p_change_set_id, v_entity_id, 'DELETE') INTO v_frame_id;
  INSERT INTO park_v1 (rdf_frame_id, id) VALUES (v_frame_id, p_id);
  PERFORM rdf_notify(c_entity_name, c_entity_version); 
END;
$$ LANGUAGE plpgsql;
```

Save these into `migrations/003.helper-functions.sql`. 

With that done we can start adding the data frames. This isn't so bad thanks to the functions we've just created.

```sql
DO $$ 

DECLARE
  v_change_set_id INTEGER;
  
BEGIN

  PERFORM rdf_add_entity('park', 1);
  PERFORM rdf_add_entity('park_calendar', 1);

  SELECT rdf_add_change_set('2019-01-01T00:00:00Z', 'Initial park data') INTO v_change_set_id;

  PERFORM put_park_v1(v_change_set_id, 'DC', 'Devon Hills');
  PERFORM put_park_v1(v_change_set_id, 'PV', 'Primrose Valley');
  PERFORM put_park_v1(v_change_set_id, 'GA', 'Greenacres'); 

  PERFORM put_park_calendar_v1(v_change_set_id, 1, 'DC', 'Park Open - Owners', '2019-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 2, 'DC', 'Park Open - Guests', '2019-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 3, 'DC', 'Park Close - Owners', '2019-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 4, 'DC', 'Park Close - Guests', '2019-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 5, 'PV', 'Park Open - Owners', '2019-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 6, 'PV', 'Park Open - Guests', '2019-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 7, 'PV', 'Park Close - Owners', '2019-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 8, 'PV', 'Park Close - Guests', '2019-11-15T00:00:00Z');

  PERFORM put_park_calendar_v1(v_change_set_id, 9,  'GA', 'Park Open - Owners', '2019-03-01T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 10, 'GA', 'Park Open - Guests', '2019-03-15T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 11, 'GA', 'Park Close - Owners', '2019-11-30T00:00:00Z');
  PERFORM put_park_calendar_v1(v_change_set_id, 12, 'GA', 'Park Close - Guests', '2019-11-15T00:00:00Z');

END $$;
```
Save this in `migrations/004.park-data.sql`

Now we need to add the projections and webhooks.

```sql
DO $$ 

DECLARE
  v_park_projection_id INTEGER;
  
BEGIN

  SELECT rdf_add_projection('park', 1) INTO v_park_projection_id;
  PERFORM rdf_add_projection_dependency(v_park_projection_id, 'park', 1);
  PERFORM rdf_add_projection_dependency(v_park_projection_id, 'park_calendar', 1);

  PERFORM rdf_add_webhook(v_park_projection_id, 'https://httpbin.org/status/500');
  PERFORM rdf_add_webhook(v_park_projection_id, 'https://httpbin.org/status/200');

END $$;
```

The penultimate step is to add a function which brings the aggregated park and calendar data together

```sql
CREATE FUNCTION get_park_v1(p_change_set_id INTEGER)
RETURNS TABLE (
  code TEXT,
  name TEXT,
  calendar_event TEXT,
  calendar_occurs TIMESTAMP WITH TIME ZONE
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.code,
    p.name,
    pc.event AS calendar_event,
    pc.occurs AS calendar_occurs
  FROM 
    get_squashed_park_v1(p_change_set_id) p
  LEFT JOIN get_squashed_park_calendar_v1(p_change_set_id) pc ON pc.park_code = p.code
  WHERE p.rdf_action <> 'DELETE' AND pc.rdf_action <> 'DELETE'  
  ORDER BY
    code ASC,
    occurs ASC;
END;
$$ LANGUAGE plpgsql;
```

Save this in `migrations/005.get_park_v1.sql`.

Finally we need to write the projection which will call the functio and transform the data.




Run `node index` to load the data into PostgreSQL
