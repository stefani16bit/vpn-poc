import { FALLBACK_LOCALE, type SupportedLocale } from '@vpn/contracts';
import { getTranslator, isSupportedLocale, type TranslationVars } from '@vpn/i18n';
import type { EmailTemplate, SmsTemplate } from '@vpn/ports';

export interface RenderedEmail {
	readonly subject: string;
	readonly text: string;
}

export function renderEmail(
	template: EmailTemplate,
	locale: string,
	variables: TranslationVars,
): RenderedEmail {
	const t = getTranslator(resolve(locale));

	return {
		subject: t(`email.${template}.subject` as never, variables),
		text: t(`email.${template}.body` as never, variables),
	};
}

export function renderSms(
	template: SmsTemplate,
	locale: string,
	variables: TranslationVars,
): string {
	return getTranslator(resolve(locale))(`sms.${template}` as never, variables);
}

function resolve(locale: string): SupportedLocale {
	return isSupportedLocale(locale) ? locale : FALLBACK_LOCALE;
}
