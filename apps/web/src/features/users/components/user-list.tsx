import type { ReactNode } from 'react';

import type { AccountUser, AssignableRole } from '@vpn/contracts';

import { useTranslator } from '@/i18n/locale-context.tsx';
import { RemoveUserDialog } from '@/features/users/components/remove-user-dialog.tsx';

const ROLE_LABEL = {
	owner: 'users.roleOwner',
	admin: 'users.roleAdmin',
	member: 'users.roleMember',
} as const;

export function UserList({
	users,
	currentUserId,
	pending,
	onChangeRole,
	onRemove,
}: {
	users: readonly AccountUser[];
	currentUserId: string | undefined;
	pending: boolean;
	onChangeRole: (id: string, role: AssignableRole) => void;
	onRemove: (id: string) => void;
}): ReactNode {
	const t = useTranslator();

	if (users.length === 0) return <p className="text-muted-foreground">{t('users.empty')}</p>;

	return (
		<ul className="space-y-4">
			{users.map((user) => {
				const isSelf = user.id === currentUserId;
				const isOwner = user.role === 'owner';
				const nextRole: AssignableRole = user.role === 'admin' ? 'member' : 'admin';

				return (
					<li key={user.id} className="rounded-md border p-4">
						<p className="font-medium">
							{user.email}
							{isSelf ? <span className="text-muted-foreground"> — {t('users.you')}</span> : null}
						</p>

						<p className="text-sm text-muted-foreground">{t(ROLE_LABEL[user.role])}</p>
						<p className="text-sm text-muted-foreground">
							{t('users.liveDevices', { count: user.liveDeviceCount })}
						</p>

						{isOwner || isSelf ? null : (
							<div className="mt-3 flex gap-2">
								<button
									type="button"
									disabled={pending}
									onClick={() => onChangeRole(user.id, nextRole)}
									className="text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
								>
									{t('users.changeRole')}
								</button>

								<RemoveUserDialog
									email={user.email}
									pending={pending}
									onConfirm={() => onRemove(user.id)}
								/>
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
