import type { ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';

import type { RootState } from '@/app/store/index.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function Nav(): ReactNode {
	const t = useTranslator();
	const { pathname } = useLocation();
	const role = useSelector((state: RootState) => state.auth.user?.role);

	const elsewhere = [
		{ to: '/', label: t('billing.accountTitle') },
		{ to: '/keys', label: t('keys.link') },
		...(role === 'admin' || role === 'owner' ? [{ to: '/users', label: t('users.link') }] : []),
	].filter((link) => link.to !== pathname);

	return (
		<nav className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
			{elsewhere.map((link) => (
				<Link
					key={link.to}
					to={link.to}
					className="text-primary underline-offset-4 hover:underline"
				>
					{link.label}
				</Link>
			))}
		</nav>
	);
}
