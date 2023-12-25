# Reference Data Framework
A framework for managing time series reference data. Features include

- Supports time series reference data
- Selectively expose reference data via a RESTful API
- Notify downstream systems of changes via webhooks

Requires a PostgreSQL database

# Getting Started
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

