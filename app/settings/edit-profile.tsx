/**
 * /settings/edit-profile
 *
 * Edits the User row only (name, businessName, businessDesc). Does NOT
 * create a new agent — that's the "Author another agent" flow which
 * routes to /profile-setup.
 *
 * Why these are separate flows:
 *   - Editing your business details should not unintentionally provision
 *     another AI agent and burn LLM authoring time + Samvaad app slots.
 *   - Authoring a new agent should not require a profile-edit ceremony
 *     when most of the form is the same.
 *
 * Backend: PUT /user/profile {name?, businessName?, businessDesc?,
 *                              industry?, language?}
 */

import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import type { LegacyColorTokens } from '../../src/constants/theme';
import { useAppTheme } from '../../src/theme/AppThemeProvider';

// Backend returns this flat (NOT wrapped in {user: ...}). See
// api/controllers/user/profile.js.
interface ProfileResponse {
  id: string;
  phone: string;
  name?: string | null;
  businessName?: string | null;
  businessDesc?: string | null;
  industry?: string | null;
  language?: string | null;
  onboardingDone: boolean;
  creditBalance?: number;
  agent?: { id: string; name: string } | null;
}

interface UpdateProfileResponse {
  success: boolean;
  user: {
    id: string;
    phone: string;
    name?: string | null;
    businessName?: string | null;
    onboardingDone: boolean;
  };
}

function useEditProfileThemeStyles() {
  const { legacyColors: COLORS } = useAppTheme();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return { COLORS, styles };
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { COLORS, styles } = useEditProfileThemeStyles();
  const setUserInStore = useAuthStore((s) => s.setUser);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessDesc, setBusinessDesc] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<ProfileResponse>('/user/profile');
        if (cancelled) return;
        setName(res.name ?? '');
        setBusinessName(res.businessName ?? '');
        setBusinessDesc(res.businessDesc ?? '');
      } catch (err: any) {
        if (!cancelled) {
          Alert.alert(t('editProfile.alerts.loadFailedTitle'), err?.message || t('common.tryAgainLater'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (saving) return;

    // Basic guards — name is the only soft-required field; business fields
    // are optional. Backend accepts allowNull on every field.
    const trimmedName = name.trim();
    const trimmedBizName = businessName.trim();
    const trimmedDesc = businessDesc.trim();

    setSaving(true);
    try {
      const res = await api.put<UpdateProfileResponse>('/user/profile', {
        name: trimmedName || null,
        businessName: trimmedBizName || null,
        businessDesc: trimmedDesc || null,
      });
      // Reflect changes in the auth store so the home + settings tabs see
      // the new values immediately without a re-login. The backend may
      // return null for cleared fields; the auth store's User type uses
      // optional (undefined) instead of nullable, so coerce at the
      // boundary. We also fold the local description edit back in (the
      // PUT response doesn't echo businessDesc).
      setUserInStore({
        ...res.user,
        name: res.user.name ?? undefined,
        businessName: res.user.businessName ?? undefined,
        businessDesc: trimmedDesc || null,
      });
      Alert.alert(t('editProfile.alerts.savedTitle'), t('editProfile.alerts.savedBody'), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert(t('editProfile.alerts.saveFailedTitle'), err?.message || t('common.tryAgainLater'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.ink} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('editProfile.title')}</Text>
        <Text style={styles.subtitle}>
          {t('editProfile.subtitle')}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t('editProfile.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('editProfile.namePlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="next"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('editProfile.businessLabel')}</Text>
          <TextInput
            style={styles.input}
            value={businessName}
            onChangeText={setBusinessName}
            placeholder={t('editProfile.businessPlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="next"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('editProfile.descLabel')}</Text>
          <Text style={styles.helper}>
            {t('editProfile.descHint')}
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={businessDesc}
            onChangeText={setBusinessDesc}
            placeholder={t('editProfile.descPlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.saveText}>{t('editProfile.saveChanges')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (COLORS: LegacyColorTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 60 },

  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 24 },

  field: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  helper: { fontSize: 12, color: COLORS.textMuted, marginBottom: 8, lineHeight: 16 },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  multiline: { minHeight: 120, paddingTop: 12 },

  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveText: { color: COLORS.textOnInk, fontSize: 15, fontWeight: '700' },

  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' },
});
