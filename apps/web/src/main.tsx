/* v8 ignore start -- browser bootstrap */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app.tsx';
import { Providers } from './app/providers.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
	<StrictMode>
		<Providers>
			<App />
		</Providers>
	</StrictMode>,
);

/* v8 ignore stop */
