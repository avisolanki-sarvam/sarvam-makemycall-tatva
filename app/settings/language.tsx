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

import { useState } from 'react';
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
import { TatvaColors, Radius, Type } from '../../src/constants/theme';

interface LanguageOption {
  code: string;
  label: string;
  native: string;
}

// Order: Hinglish first (recommended default for most users), then the
// other Indian languages by speaker count, English last.
const LANGUAGES: LanguageOption[] = [
  { code: 'hi', label: 'Hinglish',      native: 'हिंदी (Hinglish)' },
  { code: 'ta', label: 'Tamil',         native: 'தமிழ்' },
  { code: 'te', label: 'Telugu',        native: 'తెలుగు' },
  { code: 'kn', label: 'Kannada',       native: 'ಕನ್ನಡ' },
  { code: 'mr', label: 'Marathi',       native: 'मराठी' },
  { code: 'bn', label: 'Bengali',       native: 'বাংলা' },
  { code: 'en', label: 'English',       native: 'English' },
];

export default function LanguageScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
      Alert.alert('Could not save', e?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={TatvaColors.surfaceSecondary} />

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
                  <Text style={styles.rowLabel}>{lang.label}</Text>
                  <Text style={styles.rowNative}>{lang.native}</Text>
                </View>
                {isActive && (
                  <View style={styles.tickWrap}>
                    <CheckIcon size={14} color={TatvaColors.indigoContent} weight="bold" />
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
            <ActivityIndicator color={TatvaColors.contentInverse} size="small" />
          ) : (
            <Text style={styles.saveText}>{t('common.save')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: TatvaColors.borderSecondary,
  },
  backBtn: { alignSelf: 'flex-start', marginBottom: 8 },
  backTxt: { fontSize: 14, color: TatvaColors.contentSecondary, fontWeight: '500' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: TatvaColors.contentPrimary,
  },
  subtitle: {
    ...Type.bodySm,
    color: TatvaColors.contentTertiary,
    marginTop: 2,
  },

  scrollContent: { padding: 16, paddingBottom: 24 },

  group: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
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
    borderBottomColor: TatvaColors.borderPrimary,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: TatvaColors.contentPrimary,
  },
  rowNative: {
    fontSize: 13,
    color: TatvaColors.contentTertiary,
    marginTop: 2,
  },
  tickWrap: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.indigoBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveBtn: {
    backgroundColor: TatvaColors.brandPrimary,
    borderRadius: Radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: {
    color: TatvaColors.contentInverse,
    fontSize: 15,
    fontWeight: '700',
  },
});
