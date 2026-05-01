/**
 * /agents/new — Create a new agent (use-case input).
 *
 * The user has already onboarded (name + business name + business
 * description are saved on the User row). This screen collects ONLY the
 * specific use case for THIS new agent — what calling job it should do.
 *
 * Backend: POST /agents accepts { businessDescription, language }.
 * Returning users (those with user.businessDesc already saved) have their
 * saved description prepended as established context inside Agent.js
 * service, so the user-facing input here is treated as USE CASE only.
 *
 * On submit:
 *   1. POST /agents → 202 with stub Agent { id, status: 'creating' }
 *   2. router.replace('/agent-preview/:id?next=home')
 *   3. The preview screen polls and auto-routes back to /(tabs) when ready.
 *      The new agent then appears in the home agents list.
 *
 * NB: This screen replaces the "returning user" variant of the previous
 * profile-setup flow, which was dropped during the single-step onboarding
 * collapse. Multi-agent UX is now a first-class concept on the home tab.
 */

import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AudioModule, useAudioRecorder, RecordingPresets } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../src/stores/authStore';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';
import { TatvaIcon } from '../../src/components/TatvaIcon';

const MAX_RECORDING_SECONDS = 60;
const MIN_RECORDING_SECONDS = 1;

interface TranscribeResponse {
  text: string;
  language: string;
  languageProbability: number | null;
  requestId: string | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "tuition_center" → "Tuition center". Sentence case. */
function humanizeIndustry(raw?: string | null): string {
  if (!raw) return '';
  const cleaned = raw.replace(/_/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/** Resolve the language code (e.g. 'hi') to its label ('Hindi'). */
function languageLabel(code?: string | null): string {
  if (!code) return '';
  const map: Record<string, string> = {
    en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu',
    kn: 'Kannada', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati',
  };
  return map[code.toLowerCase()] || code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
}

/**
 * Build the "you already told us about" pill text.
 *   "Tuition teacher · Hindi" — when industry + language both known
 *   "Tuition teacher"          — industry only
 *   "Solanki Saree House"      — fallback to business name
 *   "Your business"            — last-resort fallback
 */
function deriveContextChip(args: {
  industry?: string | null;
  businessName?: string | null;
  language?: string | null;
  fallback: string;
}): string {
  const lang = languageLabel(args.language);
  const industry = humanizeIndustry(args.industry);
  if (industry) return lang ? `${industry} · ${lang}` : industry;
  if (args.businessName?.trim()) {
    const name = args.businessName.trim();
    return lang ? `${name} · ${lang}` : name;
  }
  return args.fallback;
}

export default function CreateAgentScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [useCase, setUseCase] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Voice input — same UX as profile-setup's description field.
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

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
        /* unmounting — ignore */
      }
    };
  }, [audioRecorder]);

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
          t('agents.new.alerts.micTitle'),
          t('agents.new.alerts.micBody'),
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
      console.warn('[agents/new] startRecording failed:', err);
      Alert.alert(
        t('agents.new.alerts.recordStartFailedTitle'),
        err?.message || t('agents.new.alerts.recordStartFailedBody'),
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
      console.warn('[agents/new] stop recording failed:', err);
      Alert.alert(t('agents.new.alerts.recordFailedTitle'), err?.message || t('agents.new.alerts.recordFailedBody'));
      return;
    }

    if (!fileUri) {
      Alert.alert(t('agents.new.alerts.recordFailedTitle'), t('agents.new.alerts.recordEmptyBody'));
      return;
    }

    if (elapsed < MIN_RECORDING_SECONDS) {
      Alert.alert(t('agents.new.alerts.tapHoldTitle'), t('agents.new.alerts.tapHoldBody'));
      return;
    }

    setIsTranscribing(true);
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const result = await api.post<TranscribeResponse>('/onboarding/transcribe', {
        audio: audioBase64,
        filename: 'use-case.m4a',
        language: 'unknown',
      });
      const text = (result.text || '').trim();
      if (!text) {
        Alert.alert(t('agents.new.alerts.couldntHearTitle'), t('agents.new.alerts.couldntHearBody'));
        return;
      }
      setUseCase(text);
    } catch (err: any) {
      Alert.alert(
        t('agents.new.alerts.transcribeFailedTitle'),
        (err?.message || 'Could not transcribe.') + t('agents.new.alerts.transcribeFailedSuffix'),
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSubmit = async () => {
    const trimmed = useCase.trim();
    if (trimmed.length < 10) {
      Alert.alert(t('agents.new.alerts.tellMoreTitle'), t('agents.new.alerts.tellMoreBody'));
      return;
    }
    setSubmitting(true);
    try {
      // POST /agents accepts { businessDescription, language }. Backend
      // service prepends the saved User.businessDesc as established
      // context, so passing the use-case as businessDescription is the
      // intended path for second/third/Nth agents.
      const result = await api.post<{ success: boolean; agent: { id: string } }>(
        '/agents',
        {
          businessDescription: trimmed,
          language: user?.language || 'en',
        },
      );
      if (!result?.success || !result.agent?.id) {
        throw new Error('Could not start assistant setup.');
      }
      // router.replace (not push) so back from the preview goes home, not
      // back to this empty form. ?next=home tells preview to auto-route
      // to /(tabs) on ready (where the new agent appears in the list).
      router.replace(`/agent-preview/${result.agent.id}?next=home`);
    } catch (err: any) {
      Alert.alert(t('agents.new.alerts.createFailedTitle'), err?.message || t('common.tryAgain'));
      setSubmitting(false);
    }
  };

  const chipText = deriveContextChip({
    industry: user?.industry,
    businessName: user?.businessName,
    language: user?.language,
    fallback: t('agents.new.yourBusiness'),
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <TouchableOpacity
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        style={styles.headerBack}
        hitSlop={12}
        accessibilityLabel={t('common.back')}
      >
        <Text style={styles.headerBackText}>← {t('common.back')}</Text>
      </TouchableOpacity>

      {/* Persistent context chip — reminds the user their business profile
          is already known and being used as context for this agent. */}
      <View style={styles.contextChip}>
        <View style={styles.contextChipDot} />
        <Text style={styles.contextChipText} numberOfLines={1}>
          {chipText}
        </Text>
      </View>

      <View style={styles.header}>
        <Text style={styles.title}>{t('agents.new.heading')}</Text>
        <Text style={styles.subtitle}>
          {t('agents.new.subtitle')}
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>{t('agents.new.useCaseLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={t('agents.new.useCasePlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          value={useCase}
          onChangeText={setUseCase}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          autoFocus
        />

        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordButtonActive]}
          onPress={handleToggleRecording}
          disabled={isTranscribing}
          activeOpacity={isTranscribing ? 1 : 0.6}
        >
          {isTranscribing ? (
            <>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.recordButtonText}>{t('common.transcribing')}</Text>
            </>
          ) : (
            <>
              <TatvaIcon
                name={isRecording ? 'stop' : 'microphone'}
                size="sm"
                color={isRecording ? COLORS.danger : COLORS.text}
                strokeWidth={2.4}
              />
              <Text style={[styles.recordButtonText, isRecording && styles.recordButtonTextActive]}>
                {isRecording
                  ? t('agents.new.recordingActive', { time: formatTime(recordingSeconds) })
                  : t('agents.new.voiceHint')}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.recordHelper}>
          {t('agents.new.voiceFootnote')}
        </Text>

        <View style={styles.bulletList}>
          {[t('agents.new.exampleHeading1'), t('agents.new.exampleHeading2')].map((line) => (
            <View key={line} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.buttonText}>{t('agents.new.createCta')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 32 },

  headerBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  headerBackText: { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },

  // Context chip — sits above the header. Tells the user their existing
  // business profile is being used as context for this new agent.
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 14,
    maxWidth: '100%',
  },
  contextChipDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.ink,
  },
  contextChipText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.ink,
    flexShrink: 1,
  },

  header: { marginBottom: 18 },
  eyebrow: { fontSize: 11, fontWeight: '500', color: COLORS.textMuted },
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: COLORS.text,
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 22 * 1.25,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 13 * 1.55,
  },

  form: { gap: 12 },
  label: { fontSize: 13, fontWeight: '500', color: COLORS.text },

  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 14 * 1.55,
  },
  textArea: { minHeight: 110, paddingTop: 12 },

  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    backgroundColor: COLORS.surface,
  },
  recordButtonActive: {
    borderColor: COLORS.danger,
    backgroundColor: COLORS.statusDeclinedBg,
  },
  recordButtonText: { fontSize: 12, fontWeight: '500', color: COLORS.text },
  recordButtonTextActive: { color: COLORS.danger },
  recordHelper: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: -4,
  },

  bulletList: { gap: 6, marginTop: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.textSecondary,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 12 * 1.5,
  },

  button: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '500' },
});
