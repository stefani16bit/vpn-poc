import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { normalizeError } from '@/app/store/api-error.js';
import { useHasPermission } from '@/app/access/use-has-permission.js';
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
import {
	useDeviceAssigneesQuery,
	useDevicesQuery,
	useRevokeDeviceMutation,
} from '@/features/keys/api/keys.api.js';
import { DeviceList } from '@/features/keys/components/device-list.tsx';
import { useGenerateDevice } from '@/features/keys/hooks/use-generate-device.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

const PROVISION_POLL_INTERVAL_MS = 2000;
const SELF = 'self';

export function KeysPage() {
	const t = useTranslator();
	const canCreate = useHasPermission('devices.create');
	const canAssign = useHasPermission('devices.assign');
	const canRevokeAny = useHasPermission('devices.revokeAll');
	const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
	const [name, setName] = useState('');
	const [owner, setOwner] = useState(SELF);
	const [awaitingProvision, setAwaitingProvision] = useState(false);

	const devices = useDevicesQuery(undefined, {
		pollingInterval: awaitingProvision ? PROVISION_POLL_INTERVAL_MS : 0,
	});
	const assignees = useDeviceAssigneesQuery(undefined, { skip: !canAssign });
	const generator = useGenerateDevice();
	const [revokeDevice, revokeState] = useRevokeDeviceMutation();

	const pending = generator.pending || revokeState.isLoading;
	const list = devices.data?.devices ?? [];
	const unprovisioned = list.some((device) => !device.provisionedAt);

	useEffect(() => {
		setAwaitingProvision(unprovisioned);
	}, [unprovisioned]);

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="text-xl">{t('keys.title')}</CardTitle>
			</CardHeader>

			<CardContent>
				<p className="text-muted-foreground">{t('keys.intro')}</p>

				<FormError error={normalizeError(generator.error ?? revokeState.error ?? devices.error)} />

				{generator.unsupported ? (
					<Alert variant="destructive" className="mt-4">
						<AlertDescription>{t('keys.unsupported')}</AlertDescription>
					</Alert>
				) : null}

				{revokeState.isSuccess ? (
					<Alert className="mt-4">
						<AlertDescription>
							{t('keys.revoked')} {t('keys.revokeClientWarning')}
						</AlertDescription>
					</Alert>
				) : null}

				{canCreate ? (
					<>
						<form
							className="mt-6"
							noValidate
							onSubmit={(event) => {
								event.preventDefault();
								void generator
									.generate(name, owner === SELF ? undefined : owner)
									.then(() => setName(''));
							}}
						>
							<Field label={t('keys.nameLabel')}>
								{(control) => (
									<Input
										{...control}
										value={name}
										placeholder={t('keys.namePlaceholder')}
										onChange={(event) => setName(event.target.value)}
									/>
								)}
							</Field>

							{canAssign ? (
								<Field label={t('keys.ownerLabel')}>
									{(control) => (
										<Select value={owner} onValueChange={setOwner}>
											<SelectTrigger {...control} className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={SELF}>{t('keys.ownerSelf')}</SelectItem>
												{(assignees.data?.users ?? [])
													.filter((user) => user.id !== currentUserId)
													.map((user) => (
														<SelectItem key={user.id} value={user.id}>
															{user.email}
														</SelectItem>
													))}
											</SelectContent>
										</Select>
									)}
								</Field>
							) : null}

							<SubmitButton pending={pending}>{t('keys.generate')}</SubmitButton>
						</form>

						<p className="mt-4 text-sm text-muted-foreground">{t('keys.downloadWarning')}</p>
						{canAssign ? (
							<p className="mt-2 text-sm text-muted-foreground">{t('keys.ownerHelp')}</p>
						) : null}
					</>
				) : null}

				{generator.downloaded ? (
					<p className="mt-2 text-sm text-muted-foreground">{t('keys.downloaded')}</p>
				) : null}

				<div className="mt-8">
					{devices.isLoading ? (
						<Loading />
					) : (
						<DeviceList
							devices={list}
							currentUserId={currentUserId}
							canRevokeAny={canRevokeAny}
							pending={pending}
							onRevoke={(id) => void revokeDevice(id)}
						/>
					)}
				</div>

				<Nav />
			</CardContent>
		</Card>
	);
}
