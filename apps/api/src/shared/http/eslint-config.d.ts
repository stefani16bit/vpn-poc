declare module '*/eslint.config.mjs' {
	const config: readonly {
		readonly files?: readonly string[];
		readonly rules?: Readonly<Record<string, unknown>>;
	}[];

	export default config;
}
