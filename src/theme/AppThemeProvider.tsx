import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
  createLegacyColors,
  createStatusToTatva,
  getTatvaColors,
} from '../constants/theme';
import type { TatvaColorTokens, ThemeMode, ThemeScheme } from '../constants/theme';

export interface AppTheme {
  mode: ThemeMode;
  scheme: ThemeScheme;
  colors: TatvaColorTokens;
  legacyColors: ReturnType<typeof createLegacyColors>;
  status: ReturnType<typeof createStatusToTatva>;
  setMode: (mode: ThemeMode) => void;
}

const DEFAULT_THEME_MODE: ThemeMode = 'system';

const AppThemeContext = createContext<AppTheme | null>(null);

interface AppThemeProviderProps {
  children: ReactNode;
  initialMode?: ThemeMode;
}

export function resolveThemeScheme(
  mode: ThemeMode,
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeScheme {
  if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
  return mode;
}

export function AppThemeProvider({
  children,
  initialMode = DEFAULT_THEME_MODE,
}: AppThemeProviderProps) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const systemScheme = useColorScheme();
  const scheme = resolveThemeScheme(mode, systemScheme);
  const colors = getTatvaColors(scheme);

  const value = useMemo<AppTheme>(
    () => ({
      mode,
      scheme,
      colors,
      legacyColors: createLegacyColors(colors),
      status: createStatusToTatva(colors),
      setMode,
    }),
    [colors, mode, scheme],
  );

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppTheme {
  const theme = useContext(AppThemeContext);
  if (!theme) {
    throw new Error('useAppTheme must be used inside AppThemeProvider');
  }
  return theme;
}
