/**
 * /profile-setup — Single-step onboarding.
 *
 * Collects Name + Business name + Business description in ONE screen, saves
 * to /user/profile (with onboardingDone:true), and routes to /(tabs).
 *
 * Decoupled from agent creation: the actual agent (POST /agents) is no
 * longer triggered here. It runs later, when the user taps "Create
 * campaign" on the home screen. The home screen handles the deferred
 * trigger; the agent-preview screen surfaces progress and routes back
 * into the campaign wizard once the agent is ready.
 *
 * Why language is dropped from the form: the description's transcribe
 * endpoint already returns a detected language, and on-the-fly typed-input
 * defaults to 'en'. The user-perceived language picker created confusion
 * (UI language vs. agent runtime language vs. transcription bias). Letting
 * the LLM/transcribe pipeline pick removes the choice without losing
 * accuracy.
 *
 * Returning users (already onboarded, want to compose another agent) hit
 * this screen via the new "Create another assistant" affordance — see
 * the chip variant. Their submission still routes back to /(tabs); agent
 * creation triggers from the campaign flow.
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
// expo-file-system v18 (SDK 54+) split the API: the modular File/Directory
// classes are at the top level, the legacy readAsStringAsync + EncodingType
// live in /legacy. We need readAsStringAsync to base64-encode the M4A
// recording before POSTing to /onboarding/transcribe — keep the legacy
// import for now. (Migration to the File class is a future cleanup.)
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../src/stores/authStore';
import { api } from '../src/services/api';
import { COLORS } from '../src/constants/api';

// Voice input — Sarvam Saaras ASR via POST /onboarding/transcribe.
// Backend accepts {audio:base64, language, filename, mode}.
const MAX_RECORDING_SECONDS = 60;        // hard cap so users don't run away
const MIN_RECORDING_SECONDS = 1;         // anything shorter is almost surely empty

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
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const [name, setName] = useState(user?.name ?? '');
  const [businessName, setBusinessName] = useState(user?.businessName ?? '');
  const [businessDesc, setBusinessDesc] = useState(user?.businessDesc ?? '');
  // Detected from the transcribe endpoint when the user records voice.
  // Defaults to whatever's already on the user row, else 'en'.
  const [detectedLanguage, setDetectedLanguage] = useState<string>(user?.language ?? 'en');
  const [saving, setSaving] = useState(false);

  // Voice input state.
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

  // Top-left back chevron: log out + return to /(auth)/login. We don't pop
  // the stack because the only thing behind us is OTP verify, which would
  // be confusing (already-verified user landing on a 'Verify OTP' screen).
  const handleHeaderBack = () => {
    Alert.alert(
      'Use a different number?',
      "You'll need to log in again with the new number.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
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
          'Microphone access needed',
          'We need microphone permission to record your business description. You can enable it in Settings.',
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
        'Could not start recording',
        err?.message || 'Try again, or type your description.',
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
      Alert.alert('Recording failed', err?.message || 'Please try again.');
      return;
    }

    if (!fileUri) {
      Alert.alert('Recording failed', 'No audio was captured. Please try again.');
      return;
    }

    if (elapsed < MIN_RECORDING_SECONDS) {
      Alert.alert('Tap and hold to speak', 'That recording was too short. Try again — speak naturally for a few seconds.');
      return;
    }

    setIsTranscribing(true);
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // language: 'unknown' tells Saaras to auto-detect from the audio.
      // The detected language is captured into local state and saved to
      // /user/profile alongside the description so subsequent agent
      // creation uses it without an explicit picker on this screen.
      const result = await api.post<TranscribeResponse>('/onboarding/transcribe', {
        audio: audioBase64,
        filename: 'business-description.m4a',
        language: 'unknown',
      });

      const text = (result.text || '').trim();
      if (!text) {
        Alert.alert(
          "Couldn't hear you clearly",
          'Try again — speak a bit louder or move somewhere quieter.',
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
        'Transcription failed',
        msg + '\n\nYou can also type your description below.',
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  /**
   * Save profile to /user/profile and route to /(tabs).
   *
   * NB: We do NOT call POST /agents here. Agent creation is deferred to
   * the "Create campaign" tap on the home screen. Setting onboardingDone:
   * true here lets the user reach the home tab on subsequent app opens
   * even though no agent exists yet.
   */
  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    if (!businessDesc.trim() || businessDesc.trim().length < 20) {
      Alert.alert(
        'Tell us a bit more',
        'Please describe your business in at least a few sentences so we can build a good assistant for you later.',
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

      // Reflect into the auth store so downstream screens (home empty
      // state, deferred agent trigger) see the saved fields immediately.
      setUser({
        name: name.trim(),
        businessName: businessName.trim() || undefined,
        businessDesc: businessDesc.trim(),
        language: detectedLanguage,
        onboardingDone: true,
      });

      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Please try again.');
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
        accessibilityLabel="Back"
      >
        <Text style={styles.headerBackText}>←</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.eyebrow}>Apne baare mein bataiye</Text>
        <Text style={styles.title}>Tell us about you and your business</Text>
        <Text style={styles.subtitle}>
          Bas ek baar. Aage badhein home screen par.
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Your name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Avi Solanki"
            placeholderTextColor={COLORS.textMuted}
            value={name}
            onChangeText={setName}
            autoFocus
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Business name (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Solanki Saree House"
            placeholderTextColor={COLORS.textMuted}
            value={businessName}
            onChangeText={setBusinessName}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Business description *</Text>
          <Text style={styles.hint}>
            Aap kya kaam karte hain? — what does your business do?
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Main ek tuition center chalata hoon, Class 8-10, Hindi medium…"
            placeholderTextColor={COLORS.textMuted}
            value={businessDesc}
            onChangeText={setBusinessDesc}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
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
                <Text style={styles.recordButtonText}>Transcribing…</Text>
              </>
            ) : (
              <>
                <Text style={styles.recordButtonIcon}>{isRecording ? '⏹' : '🎙'}</Text>
                <Text style={[styles.recordButtonText, isRecording && styles.recordButtonTextActive]}>
                  {isRecording
                    ? `Recording ${formatTime(recordingSeconds)} — tap to stop`
                    : 'Or speak it instead — bolke bataiye'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.recordHelper}>
            Voice is sent to Sarvam for transcription. Audio is not stored.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Aapka assistant abhi nahi banta — pehli campaign banaate waqt taiyaar
          hoga. (Your assistant is built when you create your first campaign.)
        </Text>
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
  headerBackText: { fontSize: 16, fontWeight: '500', color: COLORS.textSecondary },

  header: { marginBottom: 22 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: COLORS.text,
    marginTop: 4,
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 13 * 1.55,
  },

  form: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: COLORS.text },
  hint: { fontSize: 12, color: COLORS.textMuted, lineHeight: 12 * 1.55 },

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

  // Voice-record button — outlined, matches the secondary CTA pattern.
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
    marginTop: 4,
  },
  recordButtonActive: {
    borderColor: COLORS.danger,
    backgroundColor: COLORS.statusDeclinedBg,
  },
  recordButtonIcon: { fontSize: 16 },
  recordButtonText: { fontSize: 12, fontWeight: '500', color: COLORS.text },
  recordButtonTextActive: { color: COLORS.danger },
  recordHelper: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },

  // Filled-ink primary CTA — canonical pattern.
  button: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '500' },

  footnote: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 11 * 1.55,
    marginTop: 8,
  },
});
