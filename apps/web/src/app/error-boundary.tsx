import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logger } from '@/lib/logger.js';

interface ErrorBoundaryState {
	readonly failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
	override state: ErrorBoundaryState = { failed: false };

	static getDerivedStateFromError(): ErrorBoundaryState {
		return { failed: true };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		logger.error('render failed', { message: error.message, componentStack: info.componentStack });
	}

	override render(): ReactNode {
		if (!this.state.failed) return this.props.children;

		// The only user-facing literals in the app. This boundary mounts above
		// LocaleProvider, so there is no translator here by construction - and a
		// boundary that needs a working provider to render is not a boundary.
		return (
			<main className="mx-auto max-w-md p-8">
				<h1 className="mb-2 text-xl font-medium">Something went wrong</h1>
				<p className="text-muted-foreground">
					Reload the page. If it keeps happening, contact support.
				</p>
			</main>
		);
	}
}
