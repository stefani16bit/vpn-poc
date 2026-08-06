import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';

const STORAGE_KEY = 'poc-vpn.theme';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
	readonly theme: Theme;
	readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function readStoredTheme(): Theme {
	try {
		return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
	} catch {
		return 'dark';
	}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(readStoredTheme);

	const setTheme = useCallback((next: Theme) => {
		setThemeState(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// A browser with storage disabled still gets the theme it picked, it
			// just does not survive a reload.
		}
	}, []);

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
	}, [theme]);

	const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
	const value = useContext(ThemeContext);
	if (!value) throw new Error('useTheme must be used inside a ThemeProvider');
	return value;
}
