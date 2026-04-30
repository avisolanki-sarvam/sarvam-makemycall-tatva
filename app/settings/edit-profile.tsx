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

import { useEffect, useState } from 'react';
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
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';

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

export default function EditProfileScreen() {
  const router = useRouter();
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
          Alert.alert('Could not load profile', err?.message || 'Try again later.');
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
      Alert.alert('Saved', 'Your business profile has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Try again later.');
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
        <Text style={styles.title}>Edit business profile</Text>
        <Text style={styles.subtitle}>
          These details show up on the home screen and inform the agent's tone.
          Editing them here does NOT create a new agent.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Avi Solanki"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="next"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Business name</Text>
          <TextInput
            style={styles.input}
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="e.g. Sharma Kirana Store"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="next"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>What does your business do?</Text>
          <Text style={styles.helper}>
            A short description of your business. The agent uses this for context
            when speaking with your customers.
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={businessDesc}
            onChangeText={setBusinessDesc}
            placeholder="e.g. I run a small kirana store in Bengaluru. We sell groceries and household items..."
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
            <Text style={styles.saveText}>Save changes</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
