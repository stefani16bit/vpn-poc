import type { ReactNode } from 'react';

import type { Device } from '@vpn/contracts';

import { RevokeDeviceDialog } from '@/features/keys/components/revoke-device-dialog.tsx';
import { useLocale } from '@/i18n/locale-context.tsx';

export function DeviceList({
	devices,
	currentUserId,
	canRevokeAny,
	pending,
	onRevoke,
}: {
	devices: readonly Device[];
	currentUserId: string | undefined;
	canRevokeAny: boolean;
	pending: boolean;
	onRevoke: (id: string) => void;
}): ReactNode {
	const { t, locale } = useLocale();

	if (devices.length === 0) return <p className="text-muted-foreground">{t('keys.empty')}</p>;

	const shared = new Set(devices.map((device) => device.userId)).size > 1;

	return (
		<ul className="grid gap-3">
			{devices.map((device) => (
				<li key={device.id} className="grid gap-1 rounded-md border p-3">
					<div className="flex items-center justify-between gap-4">
						<span className="font-medium">{device.name}</span>
						{canRevokeAny || device.userId === currentUserId ? (
							<RevokeDeviceDialog
								name={device.name}
								pending={pending}
								onConfirm={() => onRevoke(device.id)}
							/>
						) : null}
					</div>

					{shared ? (
						<span className="text-sm text-muted-foreground">
							{t('keys.ownedBy', { email: device.userEmail })}
						</span>
					) : null}

					<span className="text-sm text-muted-foreground">
						{t('keys.address')}: {device.tunnelAddress}
					</span>

					<span className="text-sm text-muted-foreground">
						{t('keys.createdAt', { date: new Date(device.createdAt).toLocaleDateString(locale) })}
					</span>

					<span className="text-sm" role="status">
						{device.provisionedAt ? t('keys.active') : t('keys.pending')}
					</span>

					{device.provisionedAt ? null : (
						<span className="text-sm text-muted-foreground">{t('keys.pendingHelp')}</span>
					)}
				</li>
			))}
		</ul>
	);
}
