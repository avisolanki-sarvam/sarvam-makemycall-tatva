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
const TRANSCRIBE_API_TIMEOUT_HINT_S = 30; // user-facing hint only

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

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'kn', label: 'Kannada' },
  { code: 'mr', label: 'Marathi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'gu', label: 'Gujarati' },
];

export default function ProfileSetupScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessDesc, setBusinessDesc] = useState('');
  const [language, setLanguage] = useState('en');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'profile' | 'description' | 'creating'>('profile');

  // Voice input state.
  // - isRecording: mic is actively capturing audio
  // - recordingSeconds: live counter for the "0:08 recording…" UI; auto-stops at MAX
  // - isTranscribing: post-stop, while we send audio to /onboarding/transcribe
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
      // Best-effort stop. Errors are ignored — we're tearing down anyway.
      audioRecorder.stop().catch(() => {});
    };
  }, [audioRecorder]);

  // Top-left back chevron behaviour:
  // - On the description step, just rewind one sub-step (don't lose typed input).
  // - On the profile step, "back" means "I want to use a different number" — log
  //   out and bounce to login. Using router.back() here would briefly flash the
  //   OTP screen, which is confusing.
  const handleHeaderBack = () => {
    if (step === 'description') {
      setStep('profile');
      return;
    }
    Alert.alert(
      'Use a different number?',
      'You\'ll need to log in again with the new number.',
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

  const handleNext = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    setStep('description');
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      await stopRecordingAndTranscribe();
    } else {
      await startRecording();
    }
  };

  /**
   * Start a fresh recording. Three responsibilities:
   *   1. Confirm RECORD_AUDIO permission (request once if missing).
   *   2. Begin capture via expo-audio's audioRecorder.
   *   3. Spin up a 1-second timer that auto-stops at MAX_RECORDING_SECONDS
   *      so users can't accidentally record minutes-long files.
   */
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
            // Auto-stop on the cap. Use a microtask to escape the
            // setInterval callback — calling stopRecordingAndTranscribe
            // directly inside the setter is awkward.
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

  /**
   * Stop the active recording, read the file as base64, send to
   * /onboarding/transcribe, and replace the textarea with the transcript.
   *
   * Failure modes:
   *   - Clip too short → backend returns 400 audio_too_small. Show "couldn't hear, try again".
   *   - Empty transcript (silent recording) → show "couldn't hear, try again". Don't overwrite existing text.
   *   - Network error → show generic "try again". Existing text preserved.
   *   - Sarvam API error (502) → show their error message.
   */
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

      // language: 'unknown' tells Saaras to auto-detect from the audio rather
      // than biasing on the UI's selected language. Two reasons:
      //   1. Users often pick the UI language as a "language of the app"
      //      preference, then speak in something else (Hinglish, vernacular).
      //   2. Forcing language_code=hi-IN biases Saaras toward pure Hindi and
      //      degrades on code-switched Hinglish.
      // The backend's mode='codemix' default handles the code-switching part;
      // 'unknown' lets the model pick the dominant language.
      // The user's UI language selection still drives the AGENT's runtime
      // language (the agent speaks in their language); it's just not used
      // as an ASR bias here.
      const result = await api.post<TranscribeResponse>('/onboarding/transcribe', {
        audio: audioBase64,
        filename: 'business-description.m4a',
        language: 'unknown',
        // mode omitted — backend defaults to 'codemix' for Indian MSME inputs
      });

      const text = (result.text || '').trim();
      if (!text) {
        Alert.alert(
          'Couldn\'t hear you clearly',
          'Try again — speak a bit louder or move somewhere quieter.',
        );
        return;
      }

      // Replace the textarea on success. Users who want to add more can
      // type into the textarea after the transcript lands.
      setBusinessDesc(text);
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

  const handleCreateAgent = async () => {
    if (!businessDesc.trim() || businessDesc.trim().length < 20) {
      Alert.alert('Tell us more', 'Please describe your business in at least a few sentences.');
      return;
    }

    // Brief 'creating' state covers the network round-trip while the backend
    // inserts the stub Agent row and enqueues the BullMQ job. POST returns
    // 202 within ~tens of ms — the actual LLM/Samvaad work happens on the
    // preview screen, where polling progressively reveals the agent.
    setStep('creating');
    setLoading(true);

    try {
      // Profile name doesn't depend on the agent — set it now.
      await api.put('/user/profile', { name, businessName });
      setUser({ name, businessName });

      // POST returns 202 with a stub agent ({ id, status: 'creating', ... }).
      // We do NOT set onboardingDone here — that's the preview screen's job
      // once it observes the status flip to 'ready'. This way, a user who
      // kills the app mid-creation re-opens to the onboarding flow rather
      // than landing on /(tabs) with a not-yet-real agent.
      const result = await api.post<{ success: boolean; agent: { id: string } }>('/agents', {
        businessDescription: businessDesc,
        language,
      });

      if (!result?.success || !result.agent?.id) {
        throw new Error('Agent creation failed');
      }

      // Hand off to the preview screen — that's where the real "creating"
      // UX lives (skeleton → real content as the worker finishes).
      router.replace(`/agent-preview/${result.agent.id}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create your AI agent. Please try again.');
      setStep('description');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'creating') {
    // Transitional state: covers the brief POST /agents round-trip. Backend
    // returns 202 quickly with a stub, then we route to /agent-preview/[id]
    // where the polling-while-creating UX takes over. So this screen flashes
    // for ~tens of ms in the happy path; a longer dwell here means the
    // network is slow.
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.creatingTitle}>Setting things up...</Text>
        <Text style={styles.creatingSubtitle}>
          Just a moment while we get started.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <TouchableOpacity
        onPress={handleHeaderBack}
        style={styles.headerBack}
        hitSlop={12}
        accessibilityLabel="Back"
      >
        <Text style={styles.headerBackText}>{step === 'profile' ? '←' : '← Back'}</Text>
      </TouchableOpacity>
      <View style={styles.header}>
        <Text style={styles.stepIndicator}>
          Step {step === 'profile' ? '1' : '2'} of 2
        </Text>
        <Text style={styles.title}>
          {step === 'profile' ? 'Set up your profile' : 'Tell us about your business'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 'profile'
            ? "Just the basics — name, business, language"
            : "Describe in your own words — Hindi, English, anything works."}
        </Text>
      </View>

      {step === 'profile' ? (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Your name *</Text>
            <TextInput
              style={styles.input}
              placeholder="John Doe"
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
              placeholder="My Business"
              placeholderTextColor={COLORS.textMuted}
              value={businessName}
              onChangeText={setBusinessName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Preferred language</Text>
            <View style={styles.languageGrid}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.langChip,
                    language === lang.code && styles.langChipActive,
                  ]}
                  onPress={() => setLanguage(lang.code)}
                >
                  <Text
                    style={[
                      styles.langChipText,
                      language === lang.code && styles.langChipTextActive,
                    ]}
                  >
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleNext}>
            <Text style={styles.buttonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Business description</Text>
            <Text style={styles.hint}>
              What does your business do? What kind of calls would you like to make?
              The more detail you give, the better your AI agent will be.
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="e.g., I run a small finance company that provides personal loans. I need to make collection reminder calls to customers whose EMI payments are overdue..."
              placeholderTextColor={COLORS.textMuted}
              value={businessDesc}
              onChangeText={setBusinessDesc}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

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
                    : 'Or tap to describe by voice'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.recordHelper}>
            Voice is sent to Sarvam for transcription. Audio is not stored.
          </Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => setStep('profile')}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonFlex, loading && styles.buttonDisabled]}
              onPress={handleCreateAgent}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Create my assistant</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 24, paddingTop: 60 },
  headerBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 14 },
  headerBackText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary },
  header: { marginBottom: 32 },
  stepIndicator: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, lineHeight: 22 },
  form: { gap: 20 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  hint: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },
  textArea: { minHeight: 140, paddingTop: 14 },
  languageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  langChipActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  langChipText: { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },
  langChipTextActive: { color: COLORS.primary, fontWeight: '700' },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surface,
  },
  recordButtonActive: { borderColor: COLORS.danger, backgroundColor: COLORS.statusDeclinedBg },
  recordButtonIcon: { fontSize: 20 },
  recordButtonText: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  recordHelper: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  recordButtonTextActive: { color: COLORS.danger },
  buttonRow: { flexDirection: 'row', gap: 12 },
  backBtn: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonFlex: { flex: 1 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 16, fontWeight: '700' },
  creatingTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginTop: 24, marginBottom: 8 },
  creatingSubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 },
});
