import { render } from 'preact';

import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import { App } from './app';

render(<App />, document.getElementById('app') as HTMLElement);
