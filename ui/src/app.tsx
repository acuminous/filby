import { LocationProvider, Route, Router } from 'preact-iso';

import { ApiError } from './api';
import { Sidebar } from './components/Sidebar';
import { ErrorMessage } from './components/Status';
import { ChangeSets } from './screens/ChangeSets';
import { Documents } from './screens/Documents';
import { Projections } from './screens/Projections';

export function App() {
  return (
    <LocationProvider>
      <div class="shell">
        <Sidebar />
        <main>
          <Router>
            <Route path="/" component={Projections} />
            <Route path="/projections/:name/:version" component={ChangeSets} />
            <Route path="/projections/:name/:version/change-sets/:id" component={Documents} />
            <Route default component={NotFound} />
          </Router>
        </main>
      </div>
    </LocationProvider>
  );
}

function NotFound() {
  return <ErrorMessage error={new ApiError(404, `No screen for ${location.pathname}`)} />;
}
