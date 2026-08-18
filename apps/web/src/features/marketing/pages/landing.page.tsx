import type { ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';

import { CADENCES, ENTITLEMENTS, PLAN_PRICES, type Cadence } from '@vpn/contracts';

import type { RootState } from '@/app/store/index.js';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '@/components/ui/card.tsx';
import { LanguagePicker } from '@/i18n/language-picker.tsx';
import { useLocale } from '@/i18n/locale-context.tsx';
import { storeIntendedCadence } from '@/lib/intended-cadence.js';
import { ThemeToggle } from '@/theme/theme-toggle.tsx';

const TIER = 'pro';

const PRICE_KEY_BY_CADENCE = {
	monthly: 'marketing.pricing.perMonth',
	yearly: 'marketing.pricing.perYear',
} as const;

const CTA_KEY_BY_CADENCE = {
	monthly: 'marketing.pricing.startMonthly',
	yearly: 'marketing.pricing.startYearly',
} as const;

const NAME_KEY_BY_CADENCE = {
	monthly: 'marketing.pricing.monthlyLabel',
	yearly: 'marketing.pricing.yearlyLabel',
} as const;

// Never a written claim: contracts already guarantees the year costs less than
// twelve months, and a hardcoded number would outlive the next price change.
const MONTHS_FREE = Math.round(
	(PLAN_PRICES[TIER].monthly.amountCents * 12 - PLAN_PRICES[TIER].yearly.amountCents) /
		PLAN_PRICES[TIER].monthly.amountCents,
);

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

	const sections = (
		<>
			<a href="#product" className="hover:text-foreground">
				{t('marketing.nav.product')}
			</a>
			<a href="#pricing" className="hover:text-foreground">
				{t('marketing.nav.pricing')}
			</a>
		</>
	);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
					<span className="flex items-center gap-2 font-semibold">
						<span aria-hidden className="size-2.5 rounded-xs bg-primary" />
						{t('common.appName')}
					</span>

					<nav className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
						{sections}

						<LanguagePicker compact />
						<ThemeToggle />

						{signedIn ? (
							<Link to="/account" className="text-primary underline-offset-4 hover:underline">
								{t('billing.accountTitle')}
							</Link>
						) : (
							<>
								<Link to="/login" className="text-primary underline-offset-4 hover:underline">
									{t('auth.login.title')}
								</Link>
								<Button asChild size="sm">
									<Link to="/signup">{t('auth.signup.title')}</Link>
								</Button>
							</>
						)}
					</nav>
				</div>
			</header>

			<main id="main">
				<section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
					<p className="text-xs tracking-[0.14em] text-primary uppercase">
						{t('marketing.hero.eyebrow')}
					</p>

					<h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
						{t('marketing.hero.title')}
					</h1>

					<p className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
						{t('marketing.hero.body')}
					</p>

					<div className="mt-10 flex flex-wrap gap-3">
						{signedIn ? null : (
							<Button asChild size="lg">
								<Link to="/signup">{t('marketing.hero.cta')}</Link>
							</Button>
						)}

						<Button asChild size="lg" variant="outline">
							<a href="#pricing">{t('marketing.hero.secondaryCta')}</a>
						</Button>
					</div>
				</section>

				<section id="product" aria-label={t('marketing.nav.product')} className="border-t">
					<div className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3">
						<ValueCard
							title={t('marketing.value.keysTitle')}
							body={t('marketing.value.keysBody')}
						/>
						<ValueCard
							title={t('marketing.value.companyTitle')}
							body={t('marketing.value.companyBody')}
						/>
						<ValueCard
							title={t('marketing.value.regionsTitle')}
							body={t('marketing.value.regionsBody')}
						/>
					</div>
				</section>

				<section id="pricing" className="border-t">
					<div className="mx-auto max-w-5xl px-6 py-16">
						<h2 className="text-3xl font-semibold tracking-tight">
							{t('marketing.pricing.title')}
						</h2>
						<p className="mt-2 text-muted-foreground">{t('marketing.pricing.subtitle')}</p>

						<div className="mt-10 grid gap-6 sm:grid-cols-2">
							{CADENCES.map((cadence) => (
								<CadenceCard
									key={cadence}
									featured={cadence === 'yearly'}
									name={t(NAME_KEY_BY_CADENCE[cadence])}
									price={priceOf(cadence)}
									note={
										cadence === 'yearly'
											? t('marketing.pricing.monthsFree', { count: MONTHS_FREE })
											: t('marketing.pricing.yearlyNote')
									}
									badge={cadence === 'yearly' ? t('marketing.pricing.bestValue') : null}
									action={
										<Button
											asChild
											className="w-full"
											variant={cadence === 'yearly' ? 'default' : 'outline'}
										>
											<Link
												to={signedIn ? '/account' : '/signup'}
												onClick={() => storeIntendedCadence(cadence)}
											>
												{t(CTA_KEY_BY_CADENCE[cadence])}
											</Link>
										</Button>
									}
								>
									<li>{t('billing.seats', { count: entitlements.seats })}</li>
									<li>{t('billing.devicesPerUser', { count: entitlements.devicesPerUser })}</li>
									<li>{t('billing.monthlyTrafficGb', { count: entitlements.monthlyTrafficGb })}</li>
								</CadenceCard>
							))}
						</div>
					</div>
				</section>
			</main>

			<footer className="border-t">
				<div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
					<span>
						{t('marketing.footer.rights', {
							year: new Date().getFullYear(),
							name: t('common.appName'),
						})}
					</span>

					<nav className="flex gap-6">{sections}</nav>
				</div>
			</footer>
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
				<p className="text-sm text-pretty text-muted-foreground">{body}</p>
			</CardContent>
		</Card>
	);
}

function CadenceCard({
	name,
	price,
	note,
	badge,
	featured,
	action,
	children,
}: {
	name: string;
	price: string;
	note: string;
	badge: string | null;
	featured: boolean;
	action: ReactNode;
	children: ReactNode;
}): ReactNode {
	return (
		<div
			className={
				featured
					? 'flex flex-col rounded-xl border border-primary bg-card p-8 text-card-foreground shadow-sm'
					: 'flex flex-col rounded-xl border bg-card p-8 text-card-foreground shadow-sm'
			}
		>
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-xs tracking-[0.12em] text-muted-foreground uppercase">{name}</h3>

				{badge === null ? null : (
					<span className="rounded-full border border-primary px-3 py-0.5 text-xs text-primary">
						{badge}
					</span>
				)}
			</div>

			<p className="mt-5 text-4xl font-semibold tracking-tight">{price}</p>
			<p className="mt-2 text-sm text-muted-foreground">{note}</p>

			<ul className="mt-8 flex flex-1 flex-col gap-2 text-sm text-muted-foreground">{children}</ul>

			<div className="mt-8">{action}</div>
		</div>
	);
}
