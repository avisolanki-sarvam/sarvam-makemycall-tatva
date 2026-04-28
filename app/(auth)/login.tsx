import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';
import { api } from '../../src/services/api';

interface DevLoginResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    phone: string;
    name?: string;
    businessName?: string;
    onboardingDone: boolean;
  };
}

export default function LoginScreen() {
  const router = useRouter();
  const setPendingVerificationId = useAuthStore((s) => s.setPendingVerificationId);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);

  // Dev-only sign-in: hits the gated /auth/dev-login backend route. No real
  // OTP flow, no Firebase Phone Auth, no SIM needed. Backend mints a Firebase
  // ID token via firebase-admin + Firebase REST, then exchanges to our JWT
  // pair through the same AuthCoordinator path as the real OTP flow — so the
  // resulting User row is byte-identical to a real signin.
  //
  // The button only renders in __DEV__. The backend route is also gated by
  // ALLOW_DEV_LOGIN=1 + FIREBASE_WEB_API_KEY env vars, so even a leaked
  // build cannot use this against a hardened production backend.
  const handleDevLogin = async () => {
    setDevLoading(true);
    try {
      const res = await api.post<DevLoginResponse>('/auth/dev-login', {}, { auth: false });
      setAuth(res.user, res.accessToken, res.refreshToken);
      router.replace(res.user.onboardingDone ? '/(tabs)' : '/profile-setup');
    } catch (err: any) {
      Alert.alert(
        'Dev login failed',
        (err?.message || 'Backend rejected dev-login.') +
          '\n\nMake sure ALLOW_DEV_LOGIN=1 and FIREBASE_WEB_API_KEY are set on the server.',
      );
    } finally {
      setDevLoading(false);
    }
  };

  const handleSendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit phone number.');
      return;
    }
    const e164 = `+91${cleaned}`;

    setLoading(true);
    try {
      // Firebase phone auth — sends real SMS in prod, uses test numbers in dev.
      const confirmation = await auth().signInWithPhoneNumber(e164);
      setPendingVerificationId(confirmation.verificationId ?? null);
      router.push(`/(auth)/verify-otp?phone=${cleaned}`);
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg =
        code === 'auth/invalid-phone-number'
          ? 'That phone number doesn\'t look right.'
          : code === 'auth/too-many-requests'
          ? 'Too many attempts. Try again in a few minutes.'
          : err?.message || 'Failed to send OTP';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.logo}>MakeMyCall</Text>
          <Text style={styles.tagline}>Your AI phone secretary.{'\n'}Enter your number to get started.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Enter your phone number</Text>
          <View style={styles.phoneRow}>
            <View style={styles.countryCode}>
              <Text style={styles.countryCodeText}>+91</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              placeholder="9876543210"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              autoFocus
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSendOtp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Send OTP</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.disclaimer}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>

        {/* Dev-only — never renders in production builds. */}
        {__DEV__ ? (
          <View style={styles.devBlock}>
            <Text style={styles.devLabel}>Developer</Text>
            <TouchableOpacity
              style={[styles.devButton, devLoading && styles.buttonDisabled]}
              onPress={handleDevLogin}
              disabled={devLoading}
              accessibilityLabel="Sign in as a test user (dev only)"
            >
              {devLoading ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <Text style={styles.devButtonText}>Sign in as test user</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.devHint}>
              Bypasses Firebase Phone Auth using a server-side mint.{'\n'}
              Requires ALLOW_DEV_LOGIN + FIREBASE_WEB_API_KEY on the backend.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  // contentContainerStyle on ScrollView. flexGrow:1 lets the form center
  // vertically when content fits, AND lets the dev block scroll into view
  // when it doesn't (e.g. small screens, keyboard up).
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 32, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.5 },
  tagline: { fontSize: 16, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  form: { gap: 16 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  phoneRow: { flexDirection: 'row', gap: 10 },
  countryCode: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  countryCodeText: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.text,
    letterSpacing: 1,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 16, fontWeight: '700' },
  disclaimer: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: 32, lineHeight: 18 },

  // ─── Dev-only block ───
  devBlock: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSoft,
    gap: 8,
  },
  devLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  devButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  devButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  devHint: {
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 14,
    marginTop: 2,
  },
});
