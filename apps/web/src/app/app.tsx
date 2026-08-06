import { BrowserRouter } from 'react-router-dom';

import { useBootstrapAuth } from '@/features/auth/hooks/use-bootstrap-auth.js';
import { Router } from './router.tsx';

export function App() {
	useBootstrapAuth();

	return (
		<BrowserRouter>
			<main className="shell">
				<Router />
			</main>
		</BrowserRouter>
	);
}
