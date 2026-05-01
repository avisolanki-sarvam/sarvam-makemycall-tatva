/**
 * /(auth)/login — Indus-style welcome + phone entry.
 *
 * Layout, top → bottom (dark surface throughout):
 *
 *   1. Hero block — flexible centre. The Sarvam BrandMark renders at a
 *      generous size with the saffron→indigo gradient. (Photo hero
 *      placeholder; Avi will swap in the licensed asset later.)
 *
 *   2. "Welcome to Sarvam" — display-md in Fraunces (Season substitute).
 *
 *   3. Pill phone input — flag emoji + "+91" prefix + 10-digit field +
 *      circular gradient arrow button on the right (GradientButton).
 *
 *   4. Footer row — "Other sign-in options" / "Terms & Services". Dev
 *      sign-in (gated by __DEV__ + backend ALLOW_DEV_LOGIN) sits below
 *      as a subtle outline button.
 *
 * Behaviour unchanged: hits Twilio Verify via /auth/otp/start, navigates
 * to /(auth)/verify-otp on success.
 */

import { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from 'phosphor-react-native';
import { TatvaColors, Spacing, Weight } from '../../src/constants/theme';
import { api } from '../../src/services/api';
import { AppText } from '../../src/components/AppText';
import { Input } from '../../src/components/Input';
import { BrandMark } from '../../src/components/BrandMark';
import { GradientButton } from '../../src/components/GradientButton';

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      Alert.alert(t('auth.login.alerts.invalidNumberTitle'), t('auth.login.alerts.invalidNumberBody'));
      return;
    }
    const e164 = `+91${cleaned}`;

    setLoading(true);
    try {
      // Twilio Verify — backend wraps verifications.create on /auth/otp/start.
      // No verificationId needed; verify-otp.tsx posts phone+code straight to
      // /auth/otp/verify. See api/services/Otp.js + auth/otp-start.js.
      await api.post<{ success: boolean; status: string }>(
        '/auth/otp/start',
        { phone: e164 },
        { auth: false },
      );
      router.push(`/(auth)/verify-otp?phone=${cleaned}`);
    } catch (err: any) {
      const raw = String(err?.message || '');
      const msg =
        /invalid.*phone|E\.164/i.test(raw)
          ? t('auth.login.alerts.errInvalidPhone')
          : /too.?many|rate/i.test(raw)
          ? t('auth.login.alerts.errTooMany')
          : /60200|not verified|verified caller/i.test(raw)
          ? 'This number must be verified in Twilio (trial-account limitation). Add it under Phone Numbers → Verified Caller IDs.'
          : /twilio_misconfigured/i.test(raw)
          ? 'Server is missing Twilio config. Tell the dev to set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID.'
          : raw || t('auth.login.alerts.errSendFailed');
      Alert.alert(t('auth.login.alerts.errorTitle'), msg);
    } finally {
      setLoading(false);
    }
  };

  const phoneReady = phone.replace(/\D/g, '').length >= 10;

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
          <BrandMark size={160} variant="gradient" />
        </View>

        {/* ─── Welcome ───────────────────────────────────────────── */}
        <View style={styles.welcome}>
          <AppText variant="display-md" style={styles.welcomeTitle}>
            Welcome to Sarvam MakeMyCall
          </AppText>
        </View>

        {/* ─── Phone pill + arrow button ─────────────────────────── */}
        <View style={styles.phoneRow}>
          <View style={styles.phoneInputWrap}>
            <Input
              prefix="🇮🇳  +91"
              placeholder="Mobile number"
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              size="lg"
            />
          </View>
          <GradientButton
            size={56}
            onPress={handleSendOtp}
            disabled={!phoneReady || loading}
            accessibilityLabel={t('auth.login.sendOtp')}
          >
            <ArrowRightIcon
              size={20}
              color={TatvaColors.contentPrimary}
              weight="bold"
            />
          </GradientButton>
        </View>

        {/* ─── Footer row ────────────────────────────────────────── */}
        <View style={styles.footerRow}>
          <TouchableOpacity>
            <AppText
              variant="body-sm"
              tone="tertiary"
              style={{ fontWeight: Weight.regular }}
            >
              Other sign-in options
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity>
            <AppText
              variant="body-sm"
              tone="tertiary"
              style={{ fontWeight: Weight.regular }}
            >
              Terms & Services
            </AppText>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
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
    minHeight: 220,
    marginBottom: Spacing['16'],
  },

  // ─── Welcome ─────────────────────────────────────────────────
  welcome: {
    marginBottom: Spacing['10'],
  },
  welcomeTitle: {
    color: TatvaColors.contentPrimary,
  },

  // ─── Phone row ───────────────────────────────────────────────
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['5'],
    marginBottom: Spacing['8'],
  },
  phoneInputWrap: { flex: 1 },

  // ─── Footer row ──────────────────────────────────────────────
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['2'],
  },
});
