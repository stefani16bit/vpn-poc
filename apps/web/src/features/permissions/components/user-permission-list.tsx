import type { ReactNode } from 'react';

import { PERMISSIONS, type Permission, type UserGrants } from '@vpn/contracts';

import { Checkbox } from '@/components/ui/checkbox.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function UserPermissionList({
	users,
	pending,
	onToggle,
}: {
	users: readonly UserGrants[];
	pending: boolean;
	onToggle: (userId: string, permission: Permission, granted: boolean) => void;
}): ReactNode {
	const t = useTranslator();
	const others = users.filter((user) => user.role !== 'owner');

	if (others.length === 0) {
		return <p className="mt-4 text-sm text-muted-foreground">{t('permissions.byPersonEmpty')}</p>;
	}

	return (
		<ul className="mt-4 space-y-6">
			{others.map((user) => {
				const own = user.grants;

				return (
					<li key={user.userId}>
						<p className="text-sm font-semibold">{user.email}</p>

						<ul className="mt-2 space-y-2">
							{PERMISSIONS.map((permission) => {
								const override = own.find((entry) => entry.permission === permission);

								return (
									<li key={permission} className="flex items-center gap-3">
										<Checkbox
											checked={override?.granted ?? false}
											disabled={pending}
											aria-labelledby={`${user.userId}-${permission}`}
											onCheckedChange={(next) => onToggle(user.userId, permission, next === true)}
										/>
										<span id={`${user.userId}-${permission}`} className="text-sm">
											{t(`permissions.name.${permission}` as never)}
											{override ? (
												<span className="ml-2 text-xs text-muted-foreground">
													{t('permissions.modified')}
												</span>
											) : null}
										</span>
									</li>
								);
							})}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}
