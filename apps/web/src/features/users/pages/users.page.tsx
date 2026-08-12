import { useState, type ReactNode } from 'react';
import { useSelector } from 'react-redux';

import { ASSIGNABLE_ROLES, createUserRequestSchema, type AssignableRole } from '@vpn/contracts';

import { useHasPermission } from '@/app/access/use-has-permission.js';
import { normalizeError } from '@/app/store/api-error.js';
import type { RootState } from '@/app/store/index.js';
import { Field } from '@/components/form/field.tsx';
import { FormError } from '@/components/form/form-error.tsx';
import { SubmitButton } from '@/components/form/submit-button.tsx';
import { Loading } from '@/components/layout/loading.tsx';
import { Nav } from '@/components/layout/nav.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.tsx';
import { ROLE_LABEL } from '@/features/users/components/role-label.js';
import {
	useAccountUsersQuery,
	useChangeUserRoleMutation,
	useCreateUserMutation,
	useRemoveUserMutation,
} from '@/features/users/api/users.api.js';
import { TemporaryPasswordDialog } from '@/features/users/components/temporary-password-dialog.tsx';
import { UserList } from '@/features/users/components/user-list.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

interface Issued {
	readonly email: string;
	readonly password: string;
}

export function UsersPage(): ReactNode {
	const t = useTranslator();
	const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
	const canCreate = useHasPermission('users.create');
	const canUpdate = useHasPermission('users.update');
	const canDelete = useHasPermission('users.delete');

	const [email, setEmail] = useState('');
	const [role, setRole] = useState<AssignableRole>('member');
	const [issued, setIssued] = useState<Issued | null>(null);
	const [fieldError, setFieldError] = useState<string | null>(null);

	const users = useAccountUsersQuery();
	const [createUser, createState] = useCreateUserMutation();
	const [changeRole, changeState] = useChangeUserRoleMutation();
	const [removeUser, removeState] = useRemoveUserMutation();

	const pending = createState.isLoading || changeState.isLoading || removeState.isLoading;

	async function submit(event: React.FormEvent): Promise<void> {
		event.preventDefault();

		const parsed = createUserRequestSchema.safeParse({ email, role });
		if (!parsed.success) {
			setFieldError(parsed.error.issues[0]?.message ?? null);
			return;
		}

		setFieldError(null);
		const result = await createUser(parsed.data);
		if (!('data' in result) || !result.data) return;

		setIssued({ email: result.data.user.email, password: result.data.temporaryPassword });
		setEmail('');
	}

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="text-xl">{t('users.title')}</CardTitle>
			</CardHeader>

			<CardContent>
				<p className="text-muted-foreground">{t('users.intro')}</p>

				<FormError
					error={normalizeError(
						createState.error ?? changeState.error ?? removeState.error ?? users.error,
					)}
				/>

				{changeState.isSuccess ? (
					<Alert className="mt-4">
						<AlertDescription>{t('users.roleChanged')}</AlertDescription>
					</Alert>
				) : null}

				{removeState.isSuccess ? (
					<Alert className="mt-4">
						<AlertDescription>{t('users.removed')}</AlertDescription>
					</Alert>
				) : null}

				{canCreate ? (
					<form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4" noValidate>
						<Field label={t('users.emailLabel')} error={fieldError ?? undefined}>
							{(control) => (
								<Input
									{...control}
									type="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
								/>
							)}
						</Field>

						<Field label={t('users.roleLabel')}>
							{(control) => (
								<Select value={role} onValueChange={(next) => setRole(next as AssignableRole)}>
									<SelectTrigger {...control} className="w-full">
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
							)}
						</Field>

						<SubmitButton pending={pending}>{t('users.create')}</SubmitButton>
					</form>
				) : null}

				<div className="mt-8">
					{users.isLoading ? (
						<Loading />
					) : (
						<UserList
							users={users.data?.users ?? []}
							currentUserId={currentUserId}
							canChangeRole={canUpdate}
							canRemove={canDelete}
							pending={pending}
							onChangeRole={(id, next) => void changeRole({ id, role: next })}
							onRemove={(id) => void removeUser(id)}
						/>
					)}
				</div>

				<Nav />
			</CardContent>

			{issued ? (
				<TemporaryPasswordDialog
					email={issued.email}
					password={issued.password}
					onDismiss={() => setIssued(null)}
				/>
			) : null}
		</Card>
	);
}
