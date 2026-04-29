import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';

const OTP_LENGTH = 6;

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ phone: string }>();
  const phone = Array.isArray(params.phone) ? params.phone[0] : params.phone;
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const verificationId = useAuthStore((s) => s.pendingVerificationId);
  const setPendingVerificationId = useAuthStore((s) => s.setPendingVerificationId);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const hiddenInputRef = useRef<TextInput>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendTimer((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Autofocus on mount
  useEffect(() => {
    const t = setTimeout(() => hiddenInputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const handleOtpChange = (text: string) => {
    // Strip non-digits and clamp to OTP_LENGTH
    const cleaned = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(cleaned);

    // Auto-submit once we hit the full length (only once per fill)
    if (cleaned.length === OTP_LENGTH && !submittedRef.current) {
      submittedRef.current = true;
      handleVerify(cleaned);
    }
    if (cleaned.length < OTP_LENGTH) {
      submittedRef.current = false;
    }
  };

  const handleVerify = async (otpString?: string) => {
    const code = (otpString ?? otp).trim();
    if (code.length !== OTP_LENGTH) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit OTP.');
      return;
    }
    if (!verificationId) {
      Alert.alert('Session expired', 'Please request a new OTP.');
      router.replace('/(auth)/login');
      return;
    }

    setLoading(true);
    try {
      // 1. Confirm the OTP with Firebase to get a UserCredential.
      const credential = auth.PhoneAuthProvider.credential(verificationId, code);
      const userCred = await auth().signInWithCredential(credential);

      // 2. Pull a fresh Firebase ID token for the backend.
      const idToken = await userCred.user.getIdToken();

      // 3. Exchange it for our JWT pair + user row.
      const data = await api.post<{
        success: boolean;
        accessToken: string;
        refreshToken: string;
        user: any;
      }>('/auth/firebase-exchange', { idToken }, { auth: false });

      setAuth(data.user, data.accessToken, data.refreshToken);
      setPendingVerificationId(null);

      // Explicit redirect — root layout doesn't watch auth state
      if (data.user.onboardingDone) {
        router.replace('/(tabs)');
      } else {
        router.replace('/profile-setup');
      }
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg =
        code === 'auth/invalid-verification-code'
          ? 'Wrong OTP. Try again.'
          : code === 'auth/code-expired'
          ? 'OTP expired. Tap Resend to get a new one.'
          : err?.message || 'Invalid OTP';
      Alert.alert('Verification Failed', msg);
      setOtp('');
      submittedRef.current = false;
      setTimeout(() => hiddenInputRef.current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || !phone) return;
    try {
      const e164 = `+91${phone}`;
      const confirmation = await auth().signInWithPhoneNumber(e164);
      setPendingVerificationId(confirmation.verificationId ?? null);
      setResendTimer(30);
      setOtp('');
      submittedRef.current = false;
      hiddenInputRef.current?.focus();
      Alert.alert('OTP Sent', 'A new OTP has been sent to your phone.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to resend OTP');
    }
  };

  const focusInput = () => hiddenInputRef.current?.focus();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Verify OTP</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to{'\n'}
          <Text style={styles.phoneHighlight}>+91 {phone}</Text>
        </Text>

        {/* Hidden input captures the entire OTP string. */}
        <TextInput
          ref={hiddenInputRef}
          value={otp}
          onChangeText={handleOtpChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          style={styles.hiddenInput}
          caretHidden
        />

        {/* Visual boxes */}
        <TouchableWithoutFeedback onPress={focusInput}>
          <View style={styles.otpRow}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => {
              const digit = otp[i] ?? '';
              const isCurrent = i === otp.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.otpInput,
                    digit && styles.otpInputFilled,
                    isCurrent && styles.otpInputActive,
                  ]}
                >
                  <Text style={styles.otpDigit}>{digit}</Text>
                </View>
              );
            })}
          </View>
        </TouchableWithoutFeedback>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => handleVerify()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.buttonText}>Verify</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleResend} disabled={resendTimer > 0}>
          <Text style={[styles.resendText, resendTimer > 0 && styles.resendDisabled]}>
            {resendTimer > 0
              ? `Resend OTP in ${resendTimer}s`
              : 'Resend OTP'}
          </Text>
        </TouchableOpacity>

        {__DEV__ && (
          <Text style={styles.devHint}>
            Dev: use Firebase test number{'\n'}
            +91 9999999999 → 123456
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  backButton: { position: 'absolute', top: 60, left: 24 },
  backText: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 14 * 1.55, marginBottom: 28 },
  phoneHighlight: { fontWeight: '500', color: COLORS.text },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28, gap: 8 },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  otpInput: {
    flex: 1,
    height: 52,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: {
    fontSize: 20,
    fontWeight: '500',
    color: COLORS.text,
  },
  otpInputFilled: { borderColor: COLORS.ink },
  otpInputActive: { borderColor: COLORS.ink, backgroundColor: COLORS.primaryLight },
  button: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '500' },
  resendText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 18,
  },
  resendDisabled: { color: COLORS.textMuted },
  devHint: {
    fontSize: 11,
    color: COLORS.warning,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
});
