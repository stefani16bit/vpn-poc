import type { ReactNode } from 'react';

import type { UserRole } from '@vpn/contracts';

import {
	usePermissionGrantsQuery,
	useSetRoleGrantMutation,
	useSetUserGrantMutation,
} from '@/app/access/permissions.api.js';
import { normalizeError } from '@/app/store/api-error.js';
import { FormError } from '@/components/form/form-error.tsx';
import { Loading } from '@/components/layout/loading.tsx';
import { Nav } from '@/components/layout/nav.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { RolePermissionList } from '@/features/permissions/components/role-permission-list.tsx';
import { UserPermissionList } from '@/features/permissions/components/user-permission-list.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

const ROLE_LABEL: Readonly<
	Record<UserRole, 'users.roleOwner' | 'users.roleAdmin' | 'users.roleMember'>
> = {
	owner: 'users.roleOwner',
	admin: 'users.roleAdmin',
	member: 'users.roleMember',
};

export function PermissionsPage(): ReactNode {
	const t = useTranslator();

	const grants = usePermissionGrantsQuery();
	const [setRoleGrant, roleState] = useSetRoleGrantMutation();
	const [setUserGrant, userState] = useSetUserGrantMutation();

	const pending = roleState.isLoading || userState.isLoading;

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="text-xl">{t('permissions.title')}</CardTitle>
			</CardHeader>

			<CardContent>
				<p className="text-muted-foreground">{t('permissions.intro')}</p>

				<FormError error={normalizeError(roleState.error ?? userState.error ?? grants.error)} />

				{grants.isLoading ? (
					<Loading />
				) : (
					<>
						<h2 className="mt-8 mb-3 text-lg font-medium">{t('permissions.byRole')}</h2>

						{(grants.data?.roles ?? []).map((entry) => (
							<section key={entry.role} className="mt-6">
								<h3 className="text-sm font-semibold">{t(ROLE_LABEL[entry.role])}</h3>
								<RolePermissionList
									role={entry}
									pending={pending}
									onToggle={(permission, granted) =>
										void setRoleGrant({ role: entry.role, grant: { permission, granted } })
									}
								/>
							</section>
						))}

						<h2 className="mt-10 mb-3 text-lg font-medium">{t('permissions.byPerson')}</h2>
						<p className="text-sm text-muted-foreground">{t('permissions.byPersonIntro')}</p>

						<UserPermissionList
							users={grants.data?.users ?? []}
							pending={pending}
							onToggle={(userId, permission, granted) =>
								void setUserGrant({ userId, grant: { permission, granted } })
							}
						/>
					</>
				)}

				<Nav />
			</CardContent>
		</Card>
	);
}
