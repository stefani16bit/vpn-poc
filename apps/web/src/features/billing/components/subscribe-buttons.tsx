import type { ReactNode } from 'react';

import { CADENCES, type Cadence } from '@vpn/contracts';

import { Button } from '@/components/ui/button.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

const LABEL_KEY_BY_CADENCE = {
	monthly: 'billing.subscribeMonthly',
	yearly: 'billing.subscribeYearly',
} as const;

const INTENT_KEY_BY_CADENCE = {
	monthly: 'billing.intendedMonthly',
	yearly: 'billing.intendedYearly',
} as const;

export function SubscribeButtons({
	pending,
	onSubscribe,
	preselected,
}: {
	pending: boolean;
	onSubscribe: (cadence: Cadence) => void;
	preselected?: Cadence | undefined;
}): ReactNode {
	const t = useTranslator();
	const ordered =
		preselected === undefined
			? CADENCES
			: [preselected, ...CADENCES.filter((cadence) => cadence !== preselected)];

	return (
		<>
			{preselected === undefined ? null : (
				<p className="mt-4 text-sm text-muted-foreground">
					{t(INTENT_KEY_BY_CADENCE[preselected])}
				</p>
			)}

			<div className="mt-4 flex flex-wrap gap-3">
				{ordered.map((cadence, index) => (
					<Button
						key={cadence}
						type="button"
						variant={index === 0 ? 'default' : 'outline'}
						disabled={pending}
						onClick={() => onSubscribe(cadence)}
					>
						{t(LABEL_KEY_BY_CADENCE[cadence])}
					</Button>
				))}
			</div>
		</>
	);
}
