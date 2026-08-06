import { FALLBACK_LOCALE, type SupportedLocale } from '@vpn/contracts';
import { isSupportedLocale } from '@vpn/i18n';
import type { Account } from '@vpn/ports';

import { currentLocale } from '../http/request-context.js';

export function localeOf(account: Pick<Account, 'locale'>): SupportedLocale {
	if (isSupportedLocale(account.locale)) return account.locale;
	const negotiated = currentLocale();
	return isSupportedLocale(negotiated) ? negotiated : FALLBACK_LOCALE;
}
