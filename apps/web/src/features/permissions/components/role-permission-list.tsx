import type { ReactNode } from 'react';

import { PERMISSIONS, type Permission, type RoleGrants } from '@vpn/contracts';

import { Checkbox } from '@/components/ui/checkbox.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function RolePermissionList({
	role,
	pending,
	onToggle,
}: {
	role: RoleGrants;
	pending: boolean;
	onToggle: (permission: Permission, granted: boolean) => void;
}): ReactNode {
	const t = useTranslator();

	return (
		<ul className="mt-3 space-y-3">
			{PERMISSIONS.map((permission) => {
				const granted = role.effective.includes(permission);
				const diverges = role.defaults.includes(permission) !== granted;

				return (
					<li key={permission} className="flex items-start gap-3">
						<Checkbox
							checked={granted}
							disabled={pending}
							aria-labelledby={`${role.role}-${permission}`}
							onCheckedChange={(next) => onToggle(permission, next === true)}
						/>
						<div className="grid gap-1 leading-none">
							<span id={`${role.role}-${permission}`} className="text-sm font-medium">
								{t(`permissions.name.${permission}` as never)}
								{diverges ? (
									<span className="ml-2 text-xs font-normal text-muted-foreground">
										{t('permissions.modified')}
									</span>
								) : null}
							</span>
							<p className="text-xs text-muted-foreground">
								{t(`permissions.hint.${permission}` as never)}
							</p>
						</div>
					</li>
				);
			})}
		</ul>
	);
}
