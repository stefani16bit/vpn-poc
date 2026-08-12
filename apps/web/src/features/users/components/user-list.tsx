import type { ReactNode } from 'react';

import { ASSIGNABLE_ROLES, type AccountUser, type AssignableRole } from '@vpn/contracts';

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';
import { ROLE_LABEL } from '@/features/users/components/role-label.js';
import { RemoveUserDialog } from '@/features/users/components/remove-user-dialog.tsx';

export function UserList({
	users,
	currentUserId,
	canChangeRole,
	canRemove,
	pending,
	onChangeRole,
	onRemove,
}: {
	users: readonly AccountUser[];
	currentUserId: string | undefined;
	canChangeRole: boolean;
	canRemove: boolean;
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
				const editable = !isOwner && !isSelf;

				return (
					<li key={user.id} className="rounded-md border p-4">
						<p className="font-medium">
							{user.email}
							{isSelf ? <span className="text-muted-foreground"> — {t('users.you')}</span> : null}
						</p>

						{editable && canChangeRole ? null : (
							<p className="text-sm text-muted-foreground">{t(ROLE_LABEL[user.role])}</p>
						)}

						<p className="text-sm text-muted-foreground">
							{t('users.liveDevices', { count: user.liveDeviceCount })}
						</p>

						{editable ? (
							<div className="mt-3 flex items-center gap-2">
								{canChangeRole ? (
									<Select
										value={user.role}
										disabled={pending}
										onValueChange={(next) => onChangeRole(user.id, next as AssignableRole)}
									>
										<SelectTrigger size="sm" aria-label={t('users.roleOf', { email: user.email })}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ASSIGNABLE_ROLES.map((option) => (
												<SelectItem key={option} value={option}>
													{t(ROLE_LABEL[option])}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : null}

								{canRemove ? (
									<RemoveUserDialog
										email={user.email}
										pending={pending}
										onConfirm={() => onRemove(user.id)}
									/>
								) : null}
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
