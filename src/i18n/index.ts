/**
 * i18n bootstrap.
 *
 * Why this is set up the way it is:
 *
 *   - We use i18next + react-i18next + expo-localization. The first two
 *     handle interpolation, plurals, and the `t()` hook; the third reads
 *     the device's preferred locale on first run so users don't have to
 *     pick a language before the UI renders.
 *
 *   - For now we ship English-only translations. The plumbing is here so
 *     adding Hindi / Tamil / etc. later is a drop-in: create a new JSON
 *     file under ./locales/ and register it below.
 *
 *   - Initial language resolution order:
 *       1. user.language from the auth store (if the user has previously
 *          chosen one — set in /settings/language)
 *       2. The device locale via expo-localization (gives us 'hi-IN' →
 *          we strip the region to 'hi')
 *       3. Fallback to English ('en')
 *
 *   - Whenever the user picks a different language in /settings/language,
 *     call `setAppLanguage(code)` from this module and i18next will
 *     re-render every screen consuming `useTranslation()`.
 *
 * Usage:
 *
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *   <Text>{t('home.callsToday')}</Text>
 *   <Text>{t('common.namaste', { name: 'Avi' })}</Text>
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import en from './locales/en.json';

// Supported language codes. Keep in sync with the JSON files under
// ./locales/ and the picker in /settings/language. Adding a new code
// here without a matching locale file will fall back to English at
// runtime — no crash, just untranslated strings.
export type SupportedLang = 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'mr' | 'bn';

const SUPPORTED: readonly SupportedLang[] = ['en', 'hi', 'ta', 'te', 'kn', 'mr', 'bn'];

/**
 * Detect the device's preferred language and snap it to a supported
 * code. Returns 'en' if the device locale is something we don't ship.
 */
export function detectDeviceLanguage(): SupportedLang {
  try {
    const locales = Localization.getLocales();
    const code = locales[0]?.languageCode || 'en';
    return SUPPORTED.includes(code as SupportedLang)
      ? (code as SupportedLang)
      : 'en';
  } catch {
    return 'en';
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    // hi: { translation: hi },   ← drop a locale JSON next to en.json,
    // ta: { translation: ta },     register here, and that language is
    // …                            instantly available.
  },
  lng: detectDeviceLanguage(),
  fallbackLng: 'en',
  // No need to escape — RN's <Text> doesn't interpret HTML.
  interpolation: { escapeValue: false },
  // Plurals: i18next picks the right form from `_one` / `_other` keys.
  // Keep it on by default.
  compatibilityJSON: 'v4',
  // Don't crash on missing keys — fall back to the key string itself,
  // which makes missed translations obvious during dev without breaking
  // production runs.
  returnNull: false,
});

/**
 * Switch the app UI to a different language. Idempotent — calling with
 * the current language is a no-op. Persisting the choice is the caller's
 * responsibility (the language picker writes to /user/profile + the
 * auth store).
 */
export function setAppLanguage(code: SupportedLang): void {
  if (i18n.language === code) return;
  void i18n.changeLanguage(code);
}

export default i18n;
