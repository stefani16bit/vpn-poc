import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import { ThemeToggle } from '@/theme/theme-toggle.tsx';

export function AppShell(): ReactNode {
	return (
		<>
			<div className="flex justify-end p-4">
				<ThemeToggle />
			</div>

			<main id="main" className="flex justify-center px-4 pb-12">
				<Outlet />
			</main>
		</>
	);
}
