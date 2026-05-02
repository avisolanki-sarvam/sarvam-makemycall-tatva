/**
 * /profile-setup — Single-step onboarding, Indus-style.
 *
 * Collects Name + Business name + Business description in ONE screen,
 * saves to /user/profile (with onboardingDone:true), routes to /(tabs).
 * Decoupled from agent creation: actual agent creation runs later, when
 * the user taps "Create campaign" on the home screen.
 *
 * Visual treatment (matches Indus's "What should we call you?"):
 *  - Dark surface throughout, BrandMark hero up top.
 *  - Display heading in Fraunces (Season substitute).
 *  - Pill-shaped inputs across all three fields.
 *  - Multiline business-description rendered as a tall pill-styled
 *    Tatva Textarea (rounded-lg corners — full-pill on a tall textarea
 *    looks awkward).
 *  - Voice CTA: when active swaps to brand-primary surface for the
 *    Indus signature "this is the moment".
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AudioModule, useAudioRecorder, RecordingPresets } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { CaretLeftIcon } from 'phosphor-react-native';
// expo-file-system v18 split the API: modular File/Directory at top level,
// legacy readAsStringAsync + EncodingType at /legacy. We need the legacy
// path to base64-encode the M4A recording before POSTing to /onboarding/transcribe.
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../src/stores/authStore';
import { api } from '../src/services/api';
import { Radius, Spacing, Type, Weight } from '../src/constants/theme';
import type { TatvaColorTokens } from '../src/constants/theme';
import { AppText } from '../src/components/AppText';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';
import { BrandMark } from '../src/components/BrandMark';
import { TatvaIcon } from '../src/components/TatvaIcon';
import { useAppTheme } from '../src/theme/AppThemeProvider';

const MAX_RECORDING_SECONDS = 60;
const MIN_RECORDING_SECONDS = 1;

interface TranscribeResponse {
  text: string;
  language: string;
  languageProbability: number | null;
  requestId: string | null;
}

/** "8" → "0:08", "65" → "1:05" — pure-format helper for the recording counter. */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const [name, setName] = useState(user?.name ?? '');
  const [businessName, setBusinessName] = useState(user?.businessName ?? '');
  const [businessDesc, setBusinessDesc] = useState(user?.businessDesc ?? '');
  const [detectedLanguage, setDetectedLanguage] = useState<string>(user?.language ?? 'en');
  const [saving, setSaving] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // expo-audio's useAudioRecorder returns a stable recorder ref bound to the
  // chosen preset. HIGH_QUALITY is M4A/AAC at 44.1kHz — accepted by Sarvam.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Cleanup any in-flight recording if the screen unmounts mid-flow.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      try {
        const r: any = audioRecorder.stop();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) {
        /* tearing down — ignore any sync throw */
      }
    };
  }, [audioRecorder]);

  // Top-left back chevron: log out + return to /(auth)/login.
  const handleHeaderBack = () => {
    Alert.alert(
      t('profileSetup.useDifferentNumberTitle'),
      t('profileSetup.useDifferentNumberBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.logOut'),
          style: 'destructive',
          onPress: () => {
            logout();
            router.replace('/(auth)/login');
          },
        },
      ],
    );
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      await stopRecordingAndTranscribe();
    } else {
      await startRecording();
    }
  };

  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('profileSetup.alerts.micTitle'),
          t('profileSetup.alerts.micBody'),
        );
        return;
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();

      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            setTimeout(() => stopRecordingAndTranscribe(), 0);
          }
          return next;
        });
      }, 1000);
    } catch (err: any) {
      console.warn('[profile-setup] startRecording failed:', err);
      Alert.alert(
        t('profileSetup.alerts.recordStartFailedTitle'),
        err?.message || t('profileSetup.alerts.recordStartFailedBody'),
      );
      setIsRecording(false);
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);

    const elapsed = recordingSeconds;
    setRecordingSeconds(0);

    let fileUri: string | null = null;
    try {
      await audioRecorder.stop();
      fileUri = audioRecorder.uri;
    } catch (err: any) {
      console.warn('[profile-setup] stop recording failed:', err);
      Alert.alert(t('profileSetup.alerts.recordFailedTitle'), err?.message || t('profileSetup.alerts.recordFailedBody'));
      return;
    }

    if (!fileUri) {
      Alert.alert(t('profileSetup.alerts.recordFailedTitle'), t('profileSetup.alerts.recordEmptyBody'));
      return;
    }

    if (elapsed < MIN_RECORDING_SECONDS) {
      Alert.alert(t('profileSetup.alerts.tapHoldTitle'), t('profileSetup.alerts.tapHoldBody'));
      return;
    }

    setIsTranscribing(true);
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const result = await api.post<TranscribeResponse>('/onboarding/transcribe', {
        audio: audioBase64,
        filename: 'business-description.m4a',
        language: 'unknown',
      });

      const text = (result.text || '').trim();
      if (!text) {
        Alert.alert(
          t('profileSetup.alerts.couldntHearTitle'),
          t('profileSetup.alerts.couldntHearBody'),
        );
        return;
      }

      setBusinessDesc(text);
      if (result.language) {
        setDetectedLanguage(result.language.toLowerCase());
      }
    } catch (err: any) {
      const msg = err?.message || 'Could not transcribe the recording.';
      Alert.alert(
        t('profileSetup.alerts.transcribeFailedTitle'),
        msg + t('profileSetup.alerts.transcribeFailedSuffix'),
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert(t('common.errors.required'), t('profileSetup.alerts.nameRequiredBody'));
      return;
    }
    if (!businessDesc.trim() || businessDesc.trim().length < 20) {
      Alert.alert(
        t('profileSetup.alerts.tellMoreTitle'),
        t('profileSetup.alerts.tellMoreBody'),
      );
      return;
    }

    setSaving(true);
    try {
      // Single PUT carries every field collected on this screen, plus the
      // onboardingDone flag. Backend persists onboardingDone (see
      // /api/controllers/user/update-profile.js — onboardingDone added
      // April 2026 to support the deferred-agent-creation flow).
      await api.put('/user/profile', {
        name: name.trim(),
        businessName: businessName.trim() || null,
        businessDesc: businessDesc.trim(),
        language: detectedLanguage,
        onboardingDone: true,
      });

      setUser({
        name: name.trim(),
        businessName: businessName.trim() || undefined,
        businessDesc: businessDesc.trim(),
        language: detectedLanguage,
        onboardingDone: true,
      });

      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert(t('common.errors.couldNotSave'), err?.message || t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <TouchableOpacity
        onPress={handleHeaderBack}
        style={styles.headerBack}
        hitSlop={12}
        accessibilityLabel={t('common.back')}
      >
        <CaretLeftIcon size={24} color={colors.contentPrimary} weight="regular" />
      </TouchableOpacity>

      <View style={styles.hero}>
        <BrandMark size={96} variant="gradient" />
      </View>

      <AppText variant="display-md" style={styles.title}>
        What should we call you?
      </AppText>
      <AppText variant="body-md" tone="tertiary" style={styles.subtitle}>
        Enter your name to personalise your experience
      </AppText>

      <View style={styles.form}>
        <Input
          placeholder="Your name"
          value={name}
          onChangeText={setName}
          autoFocus
          size="lg"
        />

        <Input
          placeholder="Business name (optional)"
          value={businessName}
          onChangeText={setBusinessName}
          size="lg"
        />

        {/* ── Business description: multiline + voice ─────────── */}
        <View style={styles.descBlock}>
          <AppText variant="label-md" tone="secondary" style={styles.descLabel}>
            {t('profileSetup.businessDescLabel')}
          </AppText>
          <AppText variant="body-xs" tone="tertiary" style={styles.descHint}>
            {t('profileSetup.businessDescHint')}
          </AppText>

          <View style={styles.textareaShell}>
            <TextInput
              style={styles.textarea}
              placeholder={t('profileSetup.businessDescPlaceholder')}
              placeholderTextColor={colors.contentQuaternary}
              value={businessDesc}
              onChangeText={setBusinessDesc}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          {/* Voice CTA — active state flips to brand-primary surface. */}
          <TouchableOpacity
            style={[styles.recordButton, isRecording && styles.recordButtonActive]}
            onPress={handleToggleRecording}
            disabled={isTranscribing}
            activeOpacity={isTranscribing ? 1 : 0.8}
          >
            {isTranscribing ? (
              <>
                <ActivityIndicator size="small" color={colors.brandPrimary} />
                <AppText variant="body-sm" tone="indigo">
                  {t('common.transcribing')}
                </AppText>
              </>
            ) : isRecording ? (
              <>
                <TatvaIcon
                  name="stop"
                  size={18}
                  color={colors.contentInverse}
                  strokeWidth={2.4}
                />
                <AppText
                  variant="body-sm"
                  style={{ color: colors.contentInverse, fontWeight: Weight.semibold }}
                >
                  {t('profileSetup.recordingActive', { time: formatTime(recordingSeconds) })}
                </AppText>
              </>
            ) : (
              <>
                <TatvaIcon name="microphone" size={16} color={colors.contentPrimary} />
                <AppText variant="body-sm" style={{ fontWeight: Weight.semibold }}>
                  {t('profileSetup.recordingHint')}
                </AppText>
              </>
            )}
          </TouchableOpacity>

          <AppText
            variant="body-xs"
            tone="tertiary"
            align="center"
            style={styles.recordHelper}
          >
            {t('profileSetup.voiceFootnote')}
          </AppText>
        </View>

        <Button
          onPress={handleSubmit}
          isLoading={saving}
          width="full"
          size="lg"
        >
          {t('profileSetup.continue')}
        </Button>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: TatvaColorTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfacePrimary },
  scrollContent: {
    paddingHorizontal: Spacing['12'],
    paddingTop: Spacing['16'],
    paddingBottom: Spacing['16'],
  },

  headerBack: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing['3'],
    paddingHorizontal: Spacing['1'],
    marginBottom: Spacing['6'],
  },

  // ─── Hero ────────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    marginBottom: Spacing['10'],
  },

  title: { marginBottom: Spacing['2'] },
  subtitle: { marginBottom: Spacing['10'] },

  // ─── Form ────────────────────────────────────────────────────
  form: { gap: Spacing['6'] },

  descBlock: { gap: Spacing['3'], marginTop: Spacing['2'] },
  descLabel: { fontWeight: Weight.medium },
  descHint: {},

  textareaShell: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSecondary,
    paddingHorizontal: Spacing['8'],
    paddingVertical: Spacing['6'],
    minHeight: 132,
    marginTop: Spacing['1'],
  },
  textarea: {
    flex: 1,
    minHeight: 110,
    color: colors.contentPrimary,
    ...Type.bodyMd,
  },

  // ─── Voice button ───────────────────────────────────────────
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing['3'],
    paddingVertical: Spacing['5'],
    paddingHorizontal: Spacing['6'],
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSecondary,
    backgroundColor: colors.surfaceSecondary,
    marginTop: Spacing['2'],
  },
  recordButtonActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  recordHelper: { marginTop: Spacing['1'] },
});
