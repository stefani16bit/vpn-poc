/* v8 ignore start -- browser bootstrap */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';

import { App } from './app/app.tsx';
import { store } from './app/store/index.js';
import { LocaleProvider } from './i18n/locale-context.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
	<StrictMode>
		<Provider store={store}>
			<LocaleProvider>
				<App />
			</LocaleProvider>
		</Provider>
	</StrictMode>,
);

/* v8 ignore stop */
