[![Node.js CI](https://github.com/acuminous/filby/workflows/Node.js%20CI/badge.svg)](https://github.com/acuminous/filby/actions?query=workflow%3A%22Node.js+CI%22)
[![Codecov](https://codecov.io/gh/acuminous/filby/graph/badge.svg)](https://codecov.io/gh/acuminous/filby)

# Filby

Filby is a framework for managing reference data that changes over time, such as prices, tax rates or product catalogues, in PostgreSQL. This repository holds the framework, a web interface for browsing its data and an example application that uses it.

| Folder | Contents |
|--------|----------|
| [framework](framework) | The framework, its command line tool and its documentation, published to npm as [`@filby/framework`](https://www.npmjs.com/package/@filby/framework). Start with its [README](framework/README.md). |
| [ui](ui) | Filby UI, a read-only web interface to any application that serves Filby's API. See its [README](ui/README.md). |
| [examples](examples) | The holiday park example application and the migrations it loads. |

## Development

The repository is an npm workspace. Docker is required for the PostgreSQL containers.

```bash
npm install
npm run docker
npm test
npm test --workspace examples/holiday-park
npm test --workspace ui
npm run lint
```

`npm run example` starts the example application on port 3000.

## Licence

[ISC](LICENSE.txt)
