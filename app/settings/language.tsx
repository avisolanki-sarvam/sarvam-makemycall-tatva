/**
 * /settings/language — default language picker.
 *
 * Persists to the User row (PUT /user/profile {language}). The chosen
 * value drives default agent voice + the WhatsApp template language.
 *
 * Indian-language-first list, Hinglish (`hi`) is the recommended default
 * because most existing reminders are written that way. English is the
 * fallback option for users who explicitly want it.
 */

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckIcon } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import { setAppLanguage, SupportedLang } from '../../src/i18n';
import { Radius, Type } from '../../src/constants/theme';
import type { TatvaColorTokens } from '../../src/constants/theme';
import { useAppTheme } from '../../src/theme/AppThemeProvider';

// Order: Hinglish first (recommended default for most users), then the
// other Indian languages by speaker count, English last.
//
// `label` is rendered through t('language.options.<code>') at render time
// so the language name appears in the UI's current language. `native` is
// the language's own self-name in its native script — kept constant so a
// user can always pick out their language even if the UI is set to one
// they don't read.
const LANGUAGES: { code: string; native: string }[] = [
  { code: 'hi', native: 'हिंदी (Hinglish)' },
  { code: 'ta', native: 'தமிழ்' },
  { code: 'te', native: 'తెలుగు' },
  { code: 'kn', native: 'ಕನ್ನಡ' },
  { code: 'mr', native: 'मराठी' },
  { code: 'bn', native: 'বাংলা' },
  { code: 'en', native: 'English' },
];

function useLanguageThemeStyles() {
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme.colors]);
  return { ...theme, styles };
}

export default function LanguageScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, scheme, styles } = useLanguageThemeStyles();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [selected, setSelected] = useState(user?.language || 'hi');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (selected === user?.language) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      await api.put('/user/profile', { language: selected });
      // Update the cached user so the rest of the app shows the new value
      // without a refetch. setUser accepts a partial — only the changed key.
      setUser({ language: selected });
      // Live-switch the app UI language too. Once a translation file lands
      // for the chosen code (e.g. hi.json), the whole app re-renders in
      // that language. Until then it falls back to English (no error).
      setAppLanguage(selected as SupportedLang);
      router.back();
    } catch (e: any) {
      Alert.alert(t('common.errors.couldNotSave'), e?.message || t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.surfaceSecondary}
      />

      {/* ─── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backTxt}>← {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('language.title')}</Text>
        <Text style={styles.subtitle}>{t('language.subtitle')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.group}>
          {LANGUAGES.map((lang, idx) => {
            const isActive = lang.code === selected;
            const isLast = idx === LANGUAGES.length - 1;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[styles.row, !isLast && styles.rowBorder]}
                onPress={() => setSelected(lang.code)}
                activeOpacity={0.6}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{t(`language.options.${lang.code}`)}</Text>
                  <Text style={styles.rowNative}>{lang.native}</Text>
                </View>
                {isActive && (
                  <View style={styles.tickWrap}>
                    <CheckIcon size={14} color={colors.indigoContent} weight="bold" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          activeOpacity={0.85}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.contentInverse} size="small" />
          ) : (
            <Text style={styles.saveText}>{t('common.save')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: TatvaColorTokens) => StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.surfacePrimary },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSecondary,
  },
  backBtn: { alignSelf: 'flex-start', marginBottom: 8 },
  backTxt: { fontSize: 14, color: colors.contentSecondary, fontWeight: '500' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.contentPrimary,
  },
  subtitle: {
    ...Type.bodySm,
    color: colors.contentTertiary,
    marginTop: 2,
  },

  scrollContent: { padding: 16, paddingBottom: 24 },

  group: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSecondary,
    overflow: 'hidden',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderPrimary,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.contentPrimary,
  },
  rowNative: {
    fontSize: 13,
    color: colors.contentTertiary,
    marginTop: 2,
  },
  tickWrap: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: colors.indigoBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: Radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: {
    color: colors.contentInverse,
    fontSize: 15,
    fontWeight: '700',
  },
});
