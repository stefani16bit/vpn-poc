import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import type { SessionResponse } from '@vpn/contracts';

import { sessionCleared, sessionResolved } from '../app/store/auth-slice.js';
import type { AppDispatch } from '../app/store/index.js';

const baseUrl = import.meta.env['VITE_API_URL'] ?? '/api';

export function useBootstrapAuth(): void {
	const dispatch = useDispatch<AppDispatch>();
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;

		void (async () => {
			try {
				const response = await fetch(`${baseUrl}/auth/refresh`, {
					method: 'POST',
					credentials: 'include',
				});

				if (!response.ok) {
					dispatch(sessionCleared());
					return;
				}

				const session = (await response.json()) as SessionResponse;
				dispatch(sessionResolved({ user: session.user, accessToken: session.accessToken }));
			} catch {
				dispatch(sessionCleared());
			}
		})();
	}, [dispatch]);
}
