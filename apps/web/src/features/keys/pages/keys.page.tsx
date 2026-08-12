import { useEffect, useState } from 'react';

import { normalizeError } from '@/app/store/api-error.js';
import { useHasPermission } from '@/app/access/use-has-permission.js';
import { Field } from '@/components/form/field.tsx';
import { FormError } from '@/components/form/form-error.tsx';
import { SubmitButton } from '@/components/form/submit-button.tsx';
import { Loading } from '@/components/layout/loading.tsx';
import { Nav } from '@/components/layout/nav.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useDevicesQuery, useRevokeDeviceMutation } from '@/features/keys/api/keys.api.js';
import { DeviceList } from '@/features/keys/components/device-list.tsx';
import { useGenerateDevice } from '@/features/keys/hooks/use-generate-device.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

const PROVISION_POLL_INTERVAL_MS = 2000;

export function KeysPage() {
	const t = useTranslator();
	const canCreate = useHasPermission('devices.create');
	const [name, setName] = useState('');
	const [awaitingProvision, setAwaitingProvision] = useState(false);

	const devices = useDevicesQuery(undefined, {
		pollingInterval: awaitingProvision ? PROVISION_POLL_INTERVAL_MS : 0,
	});
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
								void generator.generate(name).then(() => setName(''));
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

							<SubmitButton pending={pending}>{t('keys.generate')}</SubmitButton>
						</form>

						<p className="mt-4 text-sm text-muted-foreground">{t('keys.downloadWarning')}</p>
					</>
				) : null}

				{generator.downloaded ? (
					<p className="mt-2 text-sm text-muted-foreground">{t('keys.downloaded')}</p>
				) : null}

				<div className="mt-8">
					{devices.isLoading ? (
						<Loading />
					) : (
						<DeviceList devices={list} pending={pending} onRevoke={(id) => void revokeDevice(id)} />
					)}
				</div>

				<Nav />
			</CardContent>
		</Card>
	);
}
