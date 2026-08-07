import { FALLBACK_LOCALE, type SupportedLocale } from '@vpn/contracts';
import { isSupportedLocale } from '@vpn/i18n';

import { currentLocale } from '../http/request-context.js';
import type { User } from '../identity/user.js';

export function localeOf(user: Pick<User, 'locale'>): SupportedLocale {
	if (isSupportedLocale(user.locale)) return user.locale;
	const negotiated = currentLocale();
	return isSupportedLocale(negotiated) ? negotiated : FALLBACK_LOCALE;
}
