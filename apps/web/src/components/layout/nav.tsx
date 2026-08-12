import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useHasPermission } from '@/app/access/use-has-permission.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function Nav(): ReactNode {
	const t = useTranslator();
	const { pathname } = useLocation();
	const canReadUsers = useHasPermission('users.read');
	const canManagePermissions = useHasPermission('permissions.manage');

	const elsewhere = [
		{ to: '/', label: t('billing.accountTitle') },
		{ to: '/keys', label: t('keys.link') },
		...(canReadUsers ? [{ to: '/users', label: t('users.link') }] : []),
		...(canManagePermissions ? [{ to: '/permissions', label: t('permissions.link') }] : []),
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
