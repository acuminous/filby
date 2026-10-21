# filby-ui

A read-only web UI for any application that mounts [Filby](https://github.com/acuminous/filby)'s `filby.fetch` HTTP handler. It shows the projections, the change sets of each projection and the documents at any change set, so that people can see the timeline of their reference data rather than be told about it. It uses nothing but the routes `filby.fetch` serves, so it works against every Filby application without that application changing, and it never writes anything.

## Usage

```
FILBY_API_HOST=localhost FILBY_API_PORT=3000 npx github:acuminous/filby-ui
```

This starts a small local server on port 4000 that serves the UI and proxies `/api` to the target application, which sidesteps CORS. Open http://localhost:4000. The example above points at Filby's example application, which mounts `filby.fetch` under `/api` on port 3000.

npm 12 refuses to fetch packages from git by default, so with npm 12 or later add `--allow-git=all`:

```
FILBY_API_HOST=localhost FILBY_API_PORT=3000 npx --allow-git=all github:acuminous/filby-ui
```

The target is configured with environment variables.

| Variable | Default | Meaning |
|----------|---------|---------|
| `FILBY_API_HOST` | required | The host of the application that mounts `filby.fetch` |
| `FILBY_API_PORT` | required | Its port |
| `FILBY_API_PATH` | `/api` | The base path the application mounted `filby.fetch` under |
| `FILBY_API_PROTOCOL` | `http` | `http` or `https` |
| `PORT` | `4000` | The port the UI listens on |

The proxy forwards `GET /api/*` to the target as given, preserving the query string, and answers anything else with 405. Redirects and paging links from the target are rewritten so they keep working when `FILBY_API_PATH` is not `/api`. There is no authentication; put the UI behind whatever already protects the API.

## Screens

Every screen has a sidebar listing the projections, with the one on screen marked, and a note of the time zone the dates are shown in. Dates are formatted in the browser's locale and time zone, with the UTC value on hover.

**Projections.** The list from `GET /projections`, with each projection's description and, from the OpenAPI document, its fields, its parameters and how each one matches (a single value, a list of values or a from/to range), the nested arrays in its documents and its paging. Open a projection to see its change sets.

**Change sets.** The change log of a projection from `GET /changelog` as a timeline, newest first, with each change set's id, effective date, description, last modified date and entity tag. The change set currently in force is marked as live and change sets effective in the future are flagged as not yet live. An "as of" date and time, defaulting to now, resolves to the change set in force at that instant using Filby's rule (effective on or before the instant, latest effective date first, then highest id) and highlights it on the timeline. Open a change set to see the documents at it. Escape goes back to the projections.

**Documents.** The documents of the projection at the change set from `GET /projections/<name>/v<n>?changeSetId=<id>`, as a table whose columns come from the OpenAPI response schema, with nested arrays rendered as collapsible sub-tables under their row to any depth and nulls shown muted. A picker in the header moves between change sets without leaving the screen. The projection's declared parameters become filters (text for a single value, comma separated values for a list, a from/to pair for a range) that are applied on submit and reflected in the URL, so a view can be linked to. Paging uses `page`, `pageSize`, `X-Total-Count` and the `Link` header, with a page size control bounded by the projection's maximum. Escape goes back to the change sets.

## Development

```
npm install
npm run dev
npm test
npm run build
```

`npm run dev` starts Vite with hot reloading and proxies `/api` to the target named by the same environment variables as above. `npm run build` type checks the source and writes the bundle to `dist/`, which is committed so that `npx github:acuminous/filby-ui` needs no build step; CI fails if the committed bundle is out of date, so run the build and commit `dist/` with any change to `src/`. `npm run lint` runs Biome and a pre-commit hook runs it on staged files.

The UI is Preact with [Tailwind](https://tailwindcss.com) and [daisyUI](https://daisyui.com) for the components, themed in `src/styles.css` for light and dark colour schemes, with IBM Plex Sans and IBM Plex Mono bundled so that nothing is fetched from the network.

## Licence

[ISC](LICENSE.txt)
