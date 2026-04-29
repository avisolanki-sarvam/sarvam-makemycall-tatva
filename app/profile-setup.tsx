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
  Modal,
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

/** "tuition_center" → "Tuition center". First letter only — sentence case discipline. */
function humanizeIndustry(raw?: string | null): string {
  if (!raw) return '';
  const cleaned = raw.replace(/_/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/** Resolve the language code (e.g. 'hi') to its label ('Hindi'). Falls back to capitalised code. */
function languageLabel(code?: string | null): string {
  if (!code) return '';
  const found = LANGUAGES.find((l) => l.code === code.toLowerCase());
  if (found) return found.label;
  return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
}

/**
 * Derive the chip text for the returning-user variant:
 *   1. If `industry` set → "<Industry> · <Language>" (or just "<Industry>" if no lang).
 *   2. Else if `businessName` set → "<Business name> · <Language>".
 *   3. Else fall back to a 30-char truncation of `businessDesc`.
 *   4. If everything is empty (shouldn't happen on this branch) → "Your business".
 */
function deriveChipText(args: {
  industry?: string | null;
  businessName?: string | null;
  businessDesc?: string | null;
  language?: string | null;
}): string {
  const lang = languageLabel(args.language);
  const industry = humanizeIndustry(args.industry);
  if (industry) return lang ? `${industry} · ${lang}` : industry;
  if (args.businessName && args.businessName.trim()) {
    const name = args.businessName.trim();
    return lang ? `${name} · ${lang}` : name;
  }
  if (args.businessDesc && args.businessDesc.trim()) {
    const desc = args.businessDesc.trim();
    return desc.length > 30 ? `${desc.slice(0, 30).trimEnd()}…` : desc;
  }
  return 'Your business';
}

export default function ProfileSetupScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  // Returning user iff the User row has a saved business description from a
  // prior agent-creation pass. The chip variant skips the "tell us what you
  // do" step entirely — we just want the use-case for THIS new agent.
  const isReturningUser = !!user?.businessDesc;

  const [name, setName] = useState(user?.name ?? '');
  const [businessName, setBusinessName] = useState(user?.businessName ?? '');
  const [businessDesc, setBusinessDesc] = useState('');
  const [language, setLanguage] = useState(user?.language ?? 'en');
  const [loading, setLoading] = useState(false);
  // Returning users skip 'profile' — they already have a name, just want to
  // describe the new agent's job. First-time users start at 'profile'.
  const [step, setStep] = useState<'profile' | 'description' | 'creating'>(
    isReturningUser ? 'description' : 'profile',
  );

  // Edit-context modal state (returning user variant only).
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editDesc, setEditDesc] = useState(user?.businessDesc ?? '');
  const [editSaving, setEditSaving] = useState(false);

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
      // Best-effort stop on unmount. expo-audio's .stop() returns undefined
      // synchronously when there's nothing actively recording, so we can't
      // chain .catch() blindly — wrap in try/catch + duck-type the return.
      try {
        const r: any = audioRecorder.stop();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) {
        /* tearing down — ignore any sync throw */
      }
    };
  }, [audioRecorder]);

  // Top-left back chevron behaviour:
  // - First-time user on description step → rewind to the profile step so
  //   they don't lose typed input.
  // - Returning user (chip variant) → there's no prior in-screen step; just
  //   pop back to wherever they came from (likely the home tab).
  // - First-time user on profile step → "back" means "I want to use a
  //   different number". We log them out and route to /login. Using
  //   router.back() here would flash the OTP screen, which is confusing.
  const handleHeaderBack = () => {
    if (step === 'description') {
      if (isReturningUser) {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
        return;
      }
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

  /** Open the edit modal seeded with the currently-saved business description. */
  const openEditModal = () => {
    setEditDesc(user?.businessDesc ?? '');
    setEditModalOpen(true);
  };

  /**
   * PUT the new businessDesc to /user/profile and refresh the auth store.
   * The backend re-derives industry/language on the next agent creation, so
   * we deliberately only touch the description here.
   */
  const handleSaveEdit = async () => {
    if (editSaving) return;
    const trimmed = editDesc.trim();
    if (!trimmed) {
      Alert.alert('Tell us more', 'Description cannot be empty.');
      return;
    }
    setEditSaving(true);
    try {
      await api.put('/user/profile', { businessDesc: trimmed });
      // Reflect the edit immediately in the auth store so the chip refreshes
      // and downstream screens see the new description without a re-login.
      setUser({ businessDesc: trimmed });
      setEditModalOpen(false);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Try again later.');
    } finally {
      setEditSaving(false);
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
      // Profile name doesn't depend on the agent — set it now. Skip for
      // returning users: their name/businessName are already saved and the
      // returning-user branch never collects them.
      if (!isReturningUser) {
        await api.put('/user/profile', { name, businessName });
        setUser({ name, businessName });
      }

      // POST returns 202 with a stub agent ({ id, status: 'creating', ... }).
      // We do NOT set onboardingDone here — that's the preview screen's job
      // once it observes the status flip to 'ready'. This way, a user who
      // kills the app mid-creation re-opens to the onboarding flow rather
      // than landing on /(tabs) with a not-yet-real agent.
      // Returning user: businessDescription carries ONLY the new agent's
      // use-case. Backend prepends the saved User.businessDesc as established
      // context to the LLM prompt.
      const result = await api.post<{ success: boolean; agent: { id: string } }>('/agents', {
        businessDescription: businessDesc,
        language,
      });

      if (!result?.success || !result.agent?.id) {
        throw new Error('Agent creation failed');
      }

      // Parallel-work optimisation: route the user straight into contact
      // import instead of parking them on the staged-loading preview screen.
      // While they paste / photograph / dictate their list (typically
      // 30s-2min), the BullMQ worker finishes provisioning in the background.
      // The import screen renders a thin live banner mirroring agent status,
      // and any user who wants the full staged-loading view can tap it to
      // open /agent-preview/[id].
      router.replace(`/contacts/import?agentId=${result.agent.id}`);
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

  // Returning user: persistent chip text + edit affordance.
  const chipText = isReturningUser
    ? deriveChipText({
        industry: user?.industry,
        businessName: user?.businessName,
        businessDesc: user?.businessDesc,
        language: user?.language,
      })
    : '';

  // Eyebrow / title / subtitle / placeholder copy diverge across all three
  // states (profile / first-time description / returning description).
  const eyebrowText =
    step === 'profile'
      ? 'Aapne kaun hain'
      : isReturningUser
      ? 'Naya assistant'
      : 'Aapka pehla assistant';
  const titleText =
    step === 'profile'
      ? 'Set up your profile'
      : isReturningUser
      ? 'Naya assistant kis ke liye?'
      : 'Apne business aur kaam ke baare mein bataiye';
  const subtitleText =
    step === 'profile'
      ? 'Just the basics — name, business, language.'
      : isReturningUser
      ? "What's this new assistant for?"
      : 'Tell us what you do — and what this assistant should do.';
  const textareaPlaceholder = isReturningUser
    ? 'Diwali offers aur naye batch ke liye parents ko call karna hai…'
    : 'Main ek tuition center chalata hoon, Class 8-10, Hindi medium. Parents ko mahine ke shuru mein fees yaad dilani hai…';

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

      {/* Returning-user context chip — sits above the header. */}
      {isReturningUser && step === 'description' && (
        <View style={styles.contextChip}>
          <View style={styles.contextChipDot} />
          <Text style={styles.contextChipText} numberOfLines={1}>
            {chipText}
          </Text>
          <TouchableOpacity onPress={openEditModal} hitSlop={10}>
            <Text style={styles.contextChipEdit}>Edit</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.eyebrow}>{eyebrowText}</Text>
        <Text style={styles.title}>{titleText}</Text>
        <Text style={styles.subtitle}>{subtitleText}</Text>
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
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={textareaPlaceholder}
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

          {/* Tiny dot-bullet hints — copy varies by FTUX vs returning. */}
          <View style={styles.bulletList}>
            {(isReturningUser
              ? ['Aapka business hum yaad rakh chuke hain', 'Sirf is naye assistant ka kaam batayein']
              : ['What kind of business you run', 'What this assistant should call about']
            ).map((line) => (
              <View key={line} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <View style={styles.buttonRow}>
            {/* First-time users get a "Back" rewinder; returning users skip it
                — there's no profile sub-step to rewind to. */}
            {!isReturningUser && (
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setStep('profile')}
              >
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.button, styles.buttonFlex, loading && styles.buttonDisabled]}
              onPress={handleCreateAgent}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Continue →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Edit-context modal: returning user only. Single textarea writes
          businessDesc to /user/profile and refreshes the auth store. */}
      <Modal
        visible={editModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !editSaving && setEditModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBackdropDim} pointerEvents="none" />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit business description</Text>
            <Text style={styles.modalSubtitle}>
              This is the context the assistant uses when speaking with customers.
            </Text>
            <TextInput
              style={[styles.input, styles.textArea, styles.modalInput]}
              value={editDesc}
              onChangeText={setEditDesc}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              placeholder="What does your business do?"
              placeholderTextColor={COLORS.textMuted}
              editable={!editSaving}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditModalOpen(false)}
                disabled={editSaving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonFlex, editSaving && styles.buttonDisabled]}
                onPress={handleSaveEdit}
                disabled={editSaving}
              >
                {editSaving ? (
                  <ActivityIndicator color={COLORS.textOnInk} size="small" />
                ) : (
                  <Text style={styles.buttonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 24, paddingTop: 60 },

  headerBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  headerBackText: { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },

  header: { marginBottom: 22 },
  // Small Hindi-leaning eyebrow above the title — sentence case, muted.
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

  // Inputs: surface background distinct from the cream page bg, hairline border.
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
  // The big "tell us what you do" textarea on step 2.
  textArea: { minHeight: 100, paddingTop: 12 },

  languageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  langChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
  },
  langChipActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primaryLight,
  },
  langChipText: { fontSize: 13, fontWeight: '500', color: COLORS.textSecondary },
  langChipTextActive: { color: COLORS.ink, fontWeight: '500' },

  // Voice-record button — outlined, matches the secondary CTA pattern from agent-preview.
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
  recordButtonIcon: { fontSize: 16 },
  recordButtonText: { fontSize: 12, fontWeight: '500', color: COLORS.text },
  recordButtonTextActive: { color: COLORS.danger },
  recordHelper: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },

  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  backBtn: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 13, fontWeight: '500', color: COLORS.textSecondary },

  // Filled-ink primary CTA — matches the canonical pattern.
  button: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonFlex: { flex: 1 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },

  creatingTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.text,
    marginTop: 18,
    marginBottom: 6,
  },
  creatingSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 13 * 1.55,
    paddingHorizontal: 32,
  },

  // Persistent context chip — pill above the header for returning users.
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  contextChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.ink,
  },
  contextChipText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.ink,
  },
  contextChipEdit: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.ink,
    textDecorationLine: 'underline',
  },

  // Bullet hints under the textarea — flat row pattern with tiny dot.
  bulletList: { gap: 6, marginTop: 2 },
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

  // Edit modal — centered card on a translucent backdrop. The backdrop is
  // COLORS.ink at 45% alpha; we layer a black-ink View under the card and
  // dim it with opacity so we don't have to inline an rgba literal.
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalBackdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.ink,
    opacity: 0.45,
  },
  modalCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '500', color: COLORS.text },
  modalSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 12 * 1.5,
  },
  modalInput: { minHeight: 120 },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  modalCancelBtn: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    justifyContent: 'center',
  },
  modalCancelText: { fontSize: 13, fontWeight: '500', color: COLORS.textSecondary },
});
