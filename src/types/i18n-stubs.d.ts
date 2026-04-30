/**
 * Ambient stubs for i18next, react-i18next, and expo-localization.
 *
 * Same pattern as src/types/phosphor-react-native.d.ts — these stubs let
 * `tsc --noEmit --skipLibCheck` stay green before someone runs
 * `npm install`. Once the real packages are installed, their published
 * .d.ts files take precedence and these stubs are effectively shadowed.
 *
 * Delete this file (and the phosphor stub) after the install lands.
 */

declare module 'i18next' {
  export interface InitOptions {
    resources?: Record<string, { translation: any }>;
    lng?: string;
    fallbackLng?: string;
    interpolation?: { escapeValue?: boolean };
    compatibilityJSON?: 'v3' | 'v4';
    returnNull?: boolean;
  }

  export interface i18nInstance {
    language: string;
    use(plugin: any): i18nInstance;
    init(options?: InitOptions): Promise<unknown>;
    changeLanguage(lang: string): Promise<unknown>;
    t(key: string, options?: Record<string, unknown>): string;
  }

  const i18n: i18nInstance;
  export default i18n;
}

declare module 'react-i18next' {
  export const initReactI18next: any;
  export interface UseTranslationResponse {
    t: (key: string, options?: Record<string, unknown>) => string;
    i18n: {
      language: string;
      changeLanguage: (lang: string) => Promise<unknown>;
    };
  }
  export function useTranslation(namespace?: string | string[]): UseTranslationResponse;
}

declare module 'expo-localization' {
  export interface Locale {
    languageCode: string | null;
    languageTag: string;
    regionCode: string | null;
  }
  export function getLocales(): Locale[];
  export function getCalendars(): unknown[];
}
