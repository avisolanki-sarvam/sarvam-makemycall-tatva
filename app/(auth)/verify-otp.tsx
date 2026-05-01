/**
 * /(auth)/verify-otp — OTP entry, Indus-style.
 *
 * BEHAVIOURAL CONTRACT (do not regress — see CLAUDE.md quirk #2):
 *  - Single hidden TextInput captures the entire OTP string.
 *  - Six visual boxes render derived state from the hidden input.
 *  - Backspace handling is detected via length-shrink in `onChangeText`
 *    (not onKeyPress, which is unreliable on Android with soft kbds).
 *
 * Visual treatment:
 *  - Dark surface throughout, BrandMark hero in the upper third.
 *  - "< Verify your number" — display-md in Fraunces (Season substitute),
 *    with a small chevron-left preceding it on the same baseline.
 *  - "We sent a 6-digit code to <phone>" — body-md tone="tertiary".
 *  - 6 OTP boxes rendered as a single connected pill row matching Indus's
 *    treatment: each cell is a transparent column with a thin divider, all
 *    inside one rounded-full surface.
 *  - Submit is a circular gradient button to the right of the row, mirroring
 *    the welcome screen's affordance.
 *  - Resend countdown styled as Tatva indigo link below.
 */

import { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CaretLeftIcon, ArrowRightIcon } from 'phosphor-react-native';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import { TatvaColors, Radius, Spacing, Type, Weight } from '../../src/constants/theme';
import { AppText } from '../../src/components/AppText';
import { BrandMark } from '../../src/components/BrandMark';
import { GradientButton } from '../../src/components/GradientButton';

const OTP_LENGTH = 6;

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ phone: string }>();
  const phone = Array.isArray(params.phone) ? params.phone[0] : params.phone;
  const router = useRouter();
  const { t } = useTranslation();
  const setAuth = useAuthStore((s) => s.setAuth);
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

  const handleOtpChange = (text: string) => {
    // Strip non-digits and clamp to OTP_LENGTH. Backspace detection rides
    // on length shrinkage (text shorter than current state).
    const cleaned = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(cleaned);

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
      Alert.alert(t('auth.otp.alerts.invalidTitle'), t('auth.otp.alerts.invalidBody'));
      return;
    }
    if (!phone) {
      Alert.alert(t('auth.otp.alerts.expiredTitle'), t('auth.otp.alerts.expiredBody'));
      router.replace('/(auth)/login');
      return;
    }

    setLoading(true);
    try {
      // Twilio Verify check + JWT mint in one round-trip. Backend goes through
      // the same AuthCoordinator pipeline as the legacy /auth/firebase-exchange
      // path so the User row + JWT shape are byte-identical.
      const e164 = `+91${phone}`;
      const data = await api.post<{
        success: boolean;
        accessToken: string;
        refreshToken: string;
        user: any;
      }>('/auth/otp/verify', { phone: e164, code }, { auth: false });

      setAuth(data.user, data.accessToken, data.refreshToken);

      // Explicit redirect — root layout doesn't watch auth state.
      if (data.user.onboardingDone) {
        router.replace('/(tabs)');
      } else {
        router.replace('/profile-setup');
      }
    } catch (err: any) {
      const raw = String(err?.message || '');
      const msg =
        /wrong_code|wrong otp|did not match/i.test(raw)
          ? t('auth.otp.alerts.errWrong')
          : /no_pending_verification|expired|already used/i.test(raw)
          ? t('auth.otp.alerts.errExpired')
          : /twilio_misconfigured/i.test(raw)
          ? 'Server is missing Twilio config. Tell the dev to set TWILIO_* env vars.'
          : raw || t('auth.otp.alerts.errInvalid');
      Alert.alert(t('auth.otp.alerts.verifyFailedTitle'), msg);
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
      await api.post<{ success: boolean; status: string }>(
        '/auth/otp/start',
        { phone: e164 },
        { auth: false },
      );
      setResendTimer(30);
      setOtp('');
      submittedRef.current = false;
      hiddenInputRef.current?.focus();
      Alert.alert(t('auth.otp.alerts.sentTitle'), t('auth.otp.alerts.sentBody'));
    } catch (err: any) {
      Alert.alert(t('auth.otp.alerts.errorTitle'), err.message || t('auth.otp.alerts.errResendFailed'));
    }
  };

  const focusInput = () => hiddenInputRef.current?.focus();
  const otpReady = otp.length === OTP_LENGTH;

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
        {/* ─── Hero ─────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <BrandMark size={140} variant="gradient" />
        </View>

        {/* ─── Heading + back ────────────────────────────────────── */}
        <View style={styles.titleRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <CaretLeftIcon
              size={24}
              color={TatvaColors.contentPrimary}
              weight="regular"
            />
          </TouchableOpacity>
          <AppText variant="display-md" style={styles.title}>
            Verify your number
          </AppText>
        </View>

        <AppText
          variant="body-md"
          tone="tertiary"
          style={styles.subtitle}
        >
          We sent a 6-digit code to {phone}
        </AppText>

        {/* Hidden input captures the entire OTP string. Tap anywhere on the
            visual row focuses this input. */}
        <TextInput
          ref={hiddenInputRef}
          value={otp}
          onChangeText={handleOtpChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          style={styles.hiddenInput}
          caretHidden
        />

        {/* ─── OTP pill row + gradient submit ────────────────────── */}
        <View style={styles.otpRow}>
          <TouchableWithoutFeedback onPress={focusInput}>
            <View style={styles.otpPill}>
              {Array.from({ length: OTP_LENGTH }).map((_, i) => {
                const digit = otp[i] ?? '';
                const isCurrent = i === otp.length;
                const isFilled = !!digit;
                return (
                  <View key={i} style={styles.otpCell}>
                    <AppText
                      variant="body-lg"
                      style={{
                        color: TatvaColors.contentPrimary,
                        fontWeight: Weight.semibold,
                        opacity: isFilled ? 1 : isCurrent ? 0.9 : 0.4,
                      }}
                    >
                      {digit || '|'}
                    </AppText>
                    {i < OTP_LENGTH - 1 ? (
                      <View style={styles.otpDivider} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </TouchableWithoutFeedback>

          <GradientButton
            size={56}
            onPress={() => handleVerify()}
            disabled={!otpReady || loading}
            accessibilityLabel={t('auth.otp.verify')}
          >
            <ArrowRightIcon
              size={20}
              color={TatvaColors.contentPrimary}
              weight="bold"
            />
          </GradientButton>
        </View>

        <TouchableOpacity onPress={handleResend} disabled={resendTimer > 0} style={styles.resendBtn}>
          <AppText
            variant="body-sm"
            tone={resendTimer > 0 ? 'tertiary' : 'indigo'}
            style={{ fontWeight: resendTimer > 0 ? Weight.regular : Weight.semibold }}
          >
            {resendTimer > 0
              ? `Didn't get it? Resend in ${formatTimer(resendTimer)}`
              : "Didn't get it? Resend now"}
          </AppText>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatTimer(s: number): string {
  return `00:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing['12'],
    paddingTop: Spacing['24'],
    paddingBottom: Spacing['16'],
  },

  // ─── Hero ────────────────────────────────────────────────────
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    marginBottom: Spacing['12'],
  },

  // ─── Title ───────────────────────────────────────────────────
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
    marginBottom: Spacing['3'],
  },
  backBtn: {
    paddingVertical: Spacing['1'],
  },
  title: {
    color: TatvaColors.contentPrimary,
  },
  subtitle: {
    marginBottom: Spacing['10'],
  },

  // ─── OTP pill row ────────────────────────────────────────────
  otpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['5'],
    marginBottom: Spacing['6'],
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  // The pill — single rounded-full surface with thin dividers between
  // cells. Matches the Indus OTP pattern shown in your reference.
  otpPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.borderSecondary,
    paddingHorizontal: Spacing['3'],
  },
  otpCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: TatvaColors.borderSecondary,
  },

  resendBtn: {
    marginTop: Spacing['6'],
  },
});
