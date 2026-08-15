import type { ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';

import { CADENCES, ENTITLEMENTS, PLAN_PRICES, type Cadence } from '@vpn/contracts';

import type { RootState } from '@/app/store/index.js';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '@/components/ui/card.tsx';
import { LanguagePicker } from '@/i18n/language-picker.tsx';
import { useLocale } from '@/i18n/locale-context.tsx';

const TIER = 'pro';

const PRICE_KEY_BY_CADENCE = {
	monthly: 'marketing.pricing.perMonth',
	yearly: 'marketing.pricing.perYear',
} as const;

const CTA_KEY_BY_CADENCE = {
	monthly: 'marketing.pricing.startMonthly',
	yearly: 'marketing.pricing.startYearly',
} as const;

export function LandingPage(): ReactNode {
	const { locale, t } = useLocale();
	// 'unknown' reads as signed out: an anonymous reader is the common case, and a
	// marketing page that makes them wait for a spinner has already lost them.
	const signedIn = useSelector((state: RootState) => state.auth.status) === 'authenticated';
	const entitlements = ENTITLEMENTS[TIER];

	function priceOf(cadence: Cadence): string {
		const { amountCents, currency } = PLAN_PRICES[TIER][cadence];
		const amount = new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: currency.toUpperCase(),
		}).format(amountCents / 100);

		return t(PRICE_KEY_BY_CADENCE[cadence], { price: amount });
	}

	return (
		<div className="w-full max-w-5xl">
			<header className="mb-10 flex flex-wrap items-center justify-between gap-4">
				<span className="text-lg font-semibold">{t('common.appName')}</span>

				<div className="flex flex-wrap items-center gap-4">
					<LanguagePicker />

					{signedIn ? (
						<Link to="/account" className="text-sm text-primary underline-offset-4 hover:underline">
							{t('billing.accountTitle')}
						</Link>
					) : (
						<>
							<Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
								{t('auth.login.title')}
							</Link>
							<Link
								to="/signup"
								className="text-sm text-primary underline-offset-4 hover:underline"
							>
								{t('auth.signup.title')}
							</Link>
						</>
					)}
				</div>
			</header>

			<section className="rounded-xl border bg-card p-8 text-card-foreground shadow-sm sm:p-12">
				<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
					{t('marketing.hero.title')}
				</h1>
				<p className="mt-4 max-w-2xl text-muted-foreground">{t('marketing.hero.body')}</p>

				{signedIn ? null : (
					<Button asChild className="mt-8">
						<Link to="/signup">{t('marketing.hero.cta')}</Link>
					</Button>
				)}
			</section>

			<section className="mt-8 grid gap-4 sm:grid-cols-3">
				<ValueCard title={t('marketing.value.keysTitle')} body={t('marketing.value.keysBody')} />
				<ValueCard
					title={t('marketing.value.companyTitle')}
					body={t('marketing.value.companyBody')}
				/>
				<ValueCard
					title={t('marketing.value.regionsTitle')}
					body={t('marketing.value.regionsBody')}
				/>
			</section>

			<section className="mt-8">
				<h2 className="mb-4 text-2xl font-semibold tracking-tight">
					{t('marketing.pricing.title')}
				</h2>

				<Card>
					<CardHeader>
						<h3 className="text-xl leading-none font-semibold">{t('billing.tier.pro')}</h3>
					</CardHeader>

					<CardContent>
						<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
							<p className="text-3xl font-semibold">{priceOf('monthly')}</p>
							<p className="text-muted-foreground">{priceOf('yearly')}</p>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							{t('marketing.pricing.yearlyNote')}
						</p>

						<h4 className="mt-6 text-sm font-medium text-muted-foreground">
							{t('billing.planTitle')}
						</h4>
						<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
							<li>{t('billing.seats', { count: entitlements.seats })}</li>
							<li>{t('billing.devicesPerUser', { count: entitlements.devicesPerUser })}</li>
							<li>{t('billing.monthlyTrafficGb', { count: entitlements.monthlyTrafficGb })}</li>
						</ul>

						<div className="mt-6 flex flex-wrap gap-3">
							{CADENCES.map((cadence) => (
								<Button
									key={cadence}
									asChild
									variant={cadence === 'monthly' ? 'default' : 'outline'}
								>
									<Link to={signedIn ? '/account' : '/signup'}>
										{t(CTA_KEY_BY_CADENCE[cadence])}
									</Link>
								</Button>
							))}
						</div>
					</CardContent>
				</Card>
			</section>
		</div>
	);
}

function ValueCard({ title, body }: { title: string; body: string }): ReactNode {
	return (
		<Card>
			<CardHeader>
				<h2 className="text-base leading-none font-semibold">{title}</h2>
			</CardHeader>
			<CardContent>
				<p className="text-sm text-muted-foreground">{body}</p>
			</CardContent>
		</Card>
	);
}
