import { LocationProvider, Route, Router } from 'preact-iso';

import { ApiError } from './api';
import { ErrorMessage } from './components/Status';
import { ChangeSets } from './screens/ChangeSets';
import { Documents } from './screens/Documents';
import { Projections } from './screens/Projections';

export function App() {
  return (
    <LocationProvider>
      <header class="masthead">
        <a href="/" class="brand">
          Filby
        </a>
      </header>
      <main>
        <Router>
          <Route path="/" component={Projections} />
          <Route path="/projections/:name/:version" component={ChangeSets} />
          <Route path="/projections/:name/:version/change-sets/:id" component={Documents} />
          <Route default component={NotFound} />
        </Router>
      </main>
    </LocationProvider>
  );
}

function NotFound() {
  return <ErrorMessage error={new ApiError(404, `No screen for ${location.pathname}`)} />;
}
