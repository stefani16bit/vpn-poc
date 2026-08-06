import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@vpn/contracts';
import { getTranslator, isSupportedLocale, negotiateLocale, type Translator } from '@vpn/i18n';

const STORAGE_KEY = 'poc-vpn.locale';

interface LocaleContextValue {
	readonly locale: SupportedLocale;
	readonly setLocale: (locale: SupportedLocale) => void;
	readonly t: Translator;
	readonly available: readonly SupportedLocale[];
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function readStoredLocale(): SupportedLocale {
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (isSupportedLocale(stored)) return stored;
	} catch {
		return FALLBACK_LOCALE;
	}
	return negotiateLocale(window.navigator.language);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<SupportedLocale>(readStoredLocale);

	const setLocale = useCallback((next: SupportedLocale) => {
		setLocaleState(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// A browser with storage disabled still gets the language it picked,
			// it just does not survive a reload.
		}
	}, []);

	const value = useMemo<LocaleContextValue>(
		() => ({ locale, setLocale, t: getTranslator(locale), available: SUPPORTED_LOCALES }),
		[locale, setLocale],
	);

	return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
	const value = useContext(LocaleContext);
	if (!value) throw new Error('useLocale must be used inside a LocaleProvider');
	return value;
}

export function useTranslator(): Translator {
	return useLocale().t;
}
