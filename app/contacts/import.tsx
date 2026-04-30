/**
 * /contacts/import?agentId=...&mode=...
 *
 * Four-mode contact intake screen — paste, photo, voice, phone contacts.
 * All four funnel into a single review step. Two CTAs from review:
 *
 *   - "Save kar lein" (always visible) — POST /contacts/bulk, route to
 *     /(tabs). The save path is decoupled from agent state.
 *
 *   - "Abhi call karein" (only when ?agentId= is provided) — runs
 *     POST /agents/:id/validate, then POST /agents/:id/launch with the
 *     parsed contacts. Used when this screen is entered as part of an
 *     agent's "Create campaign" flow.
 *
 * Query params:
 *   - agentId — optional. With it, the launch CTA appears and the live
 *     agent-creation banner polls /agents/:id at the top of the screen.
 *     Without it (e.g. entered from the Contacts tab to add contacts to
 *     the library), the screen is save-only.
 *   - mode    — optional initial tab: 'paste' | 'photo' | 'voice' |
 *     'contacts'. Defaults to 'paste'. Lets per-mode buttons on the
 *     Contacts tab deep-link straight to a chosen input.
 *
 * Why one screen / four tabs (vs. four routes): the user doesn't yet know
 * which mode is best for them. Showing all four side-by-side as tabs is a
 * cheaper choice than asking them to back-out and try a different route.
 *
 * Mode pipelines:
 *   paste    → POST /onboarding/parse-notes  { text, language }
 *   photo    → POST /onboarding/parse-image  { imageBase64, mimeType, language }
 *   voice    → POST /onboarding/transcribe   { audio, filename, language }
 *              → POST /onboarding/parse-notes { text, language }   (chained)
 *   contacts → format selected device contacts → POST /onboarding/parse-notes
 *
 * Review → launch:
 *   On entry to review we fire `POST /agents/:id/validate` once to confirm
 *   the agent is callable (status, phone, config). If invalid we surface
 *   `errors[0].hint` verbatim and replace the launch CTA with a banner.
 *
 *   The launch itself is a single round-trip:
 *     POST /agents/:id/launch  { contacts, defaultVariables }
 *   On 202 / success=true we route to /campaigns/:id (same as before). On a
 *   200 / success=false (insufficient credits, agent not ready) we Alert the
 *   hint and stay on the review screen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  FlatList,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AudioModule, useAudioRecorder, RecordingPresets } from 'expo-audio';
// expo-file-system v19 split: legacy readAsStringAsync still lives in /legacy.
// Used to base64 the recorded audio + the picked image.
import * as FileSystem from 'expo-file-system/legacy';
import { Feather } from '@expo/vector-icons';
import { api, readEnvelope } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';
import { loadDeviceContacts, type DeviceContact } from '../../src/services/contactImport';

// ─────────────────────────────────────────────────────────────────────────────
// Types

type Mode = 'paste' | 'photo' | 'voice' | 'contacts';

interface ParsedContact {
  name: string | null;
  phone: string | null;
  variables?: Record<string, string>;
}

interface SkippedLine {
  line: string;
  reason: string;
}

// Backend has shipped two field-name conventions — older code reads `rows`,
// the prompt promises `contacts`. Accept both, normalise once.
interface ParseResponse {
  contacts?: ParsedContact[];
  rows?: ParsedContact[];
  defaultVariables?: Record<string, string>;
  detectedIntent?: string | null;
  skipped?: SkippedLine[];
}

interface TranscribeResponse {
  text: string;
}

// Lightweight subset of the agent shape we need for the live banner — just
// enough to drive the state machine. Mirrors fields written by the BullMQ
// worker on /agents/:id; full Agent type lives in app/agent-preview/[id].tsx.
interface AgentLite {
  id: string;
  name?: string;
  status?: 'creating' | 'ready' | 'failed';
  creationStage?: 'parsing' | 'designing' | 'translating' | 'deploying' | 'ready' | null;
}

// New /agents/:id/validate envelope. Wrapped in the standard
// { success, data, errors[] } shape — readEnvelope() does the unpacking.
interface ValidateData {
  valid: boolean;
  agent?: { id: string; status: string; name: string };
}

// New /agents/:id/launch envelope. Same wrapper.
interface LaunchData {
  campaign: { id: string };
  contactCount: number;
  created: number;
  reused: number;
}

// Editable row in the review state. We keep the original index so the user
// can delete rows without re-keying everything.
interface EditableRow {
  name: string;
  phone: string;
  variables: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants

const MIN_RECORDING_SECONDS = 2;
// Sarvam's synchronous /speech-to-text endpoint caps at 30 seconds — anything
// longer comes back as HTTP 400 "Audio duration exceeds the maximum limit of
// 30 seconds. Please use the batch API for longer audio files." We auto-stop
// at 28 to leave a 2-second safety margin (recording stop + upload have a
// brief tail). Going batch would require async polling — out of scope for v1.
const MAX_RECORDING_SECONDS = 28;

const PASTE_PLACEHOLDER =
  'Sharma ji 9876543210, Ramesh 8765432109 — 1500 baaki, Auntie ji 7654321098';

const MONOSPACE = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Live-banner polling cadence. Mirrors /agent-preview/[id]: one GET every 2s
// up to a 60s cap. After that we stop polling and show a quiet "background"
// note — the worker is still running, the user just doesn't get live updates.
const BANNER_POLL_INTERVAL_MS = 2000;
const BANNER_MAX_POLLS = 30; // 30 × 2s = 60s
// How long the green "ready" confirmation lingers before the banner unmounts.
const READY_CONFIRMATION_MS = 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Live agent-creation banner
//
// Sits flush above the mode tabs while the BullMQ worker provisions the
// agent in the background. Polls GET /agents/:agentId every 2s, mirrors the
// staged-loading copy from /agent-preview/[id], and self-unmounts shortly
// after status flips to 'ready'.
//
// State machine:
//   creating + parsing/null → spinner + "samjha raha hoon…"
//   creating + designing    → spinner + "taiyaar kar raha hoon…"
//   creating + translating  → spinner + "languages sikha raha hoon…"
//   creating + deploying    → spinner + "phone number assign…"
//   ready                   → check + "✓ {name} taiyaar hai", fades after 3s
//   failed                  → warning + tap to re-create
//   timed out (60s, still creating) → quiet "background mein chal raha hai"
//
// Tapping (except in the failed state, which has its own action) pushes to
// /agent-preview/${agentId} so users can see the full staged-loading screen.

type BannerStage = 'parsing' | 'designing' | 'translating' | 'deploying';

const BANNER_STAGE_COPY: Record<BannerStage, { hi: string; en: string }> = {
  parsing: {
    hi: 'Aapka assistant samjha raha hoon...',
    en: 'Reading your business...',
  },
  designing: {
    hi: 'Aapka assistant taiyaar kar raha hoon...',
    en: 'Designing your assistant...',
  },
  translating: {
    hi: 'Hindi, Tamil mein bolna sikha raha hoon...',
    en: 'Teaching it to switch languages...',
  },
  deploying: {
    hi: 'Phone number assign kar raha hoon...',
    en: 'Reserving your phone number...',
  },
};

function AgentCreationBanner({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentLite | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // showReadyConfirmation lingers for READY_CONFIRMATION_MS once we observe
  // status === 'ready', so the user sees a quick "✓ taiyaar hai" before the
  // banner unmounts. Decoupled from agent.status so a late poll arriving
  // after the fade doesn't re-show the banner.
  const [showReadyConfirmation, setShowReadyConfirmation] = useState(false);

  useEffect(() => {
    // Per-agentId effect. Resets all locals on agentId change so a rapid
    // re-author doesn't leave the previous agent's state stuck on screen.
    let cancelled = false;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let readyTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;

    setAgent(null);
    setTimedOut(false);
    setShowReadyConfirmation(false);

    async function tick() {
      if (cancelled) return;
      try {
        const res = await api.get<{ agent: AgentLite }>(`/agents/${agentId}`);
        if (cancelled) return;
        setAgent(res.agent);

        const status = res.agent.status || 'ready';

        if (status === 'ready') {
          // Show the green confirmation, then unmount via showReadyConfirmation
          // flipping back to false. We don't keep polling.
          setShowReadyConfirmation(true);
          readyTimeoutId = setTimeout(() => {
            if (!cancelled) setShowReadyConfirmation(false);
          }, READY_CONFIRMATION_MS);
          return;
        }
        if (status === 'failed') {
          // Failed-state UI is sticky — let the user tap "Re-create" rather
          // than auto-dismissing.
          return;
        }

        // Still creating — schedule next poll if under the cap.
        polls += 1;
        if (polls >= BANNER_MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        pollTimeoutId = setTimeout(tick, BANNER_POLL_INTERVAL_MS);
      } catch {
        // Network blip — try again at the same cadence rather than going
        // silent. Errors here aren't user-visible; the banner just stays on
        // its previous frame until a poll succeeds.
        if (cancelled) return;
        polls += 1;
        if (polls >= BANNER_MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        pollTimeoutId = setTimeout(tick, BANNER_POLL_INTERVAL_MS);
      }
    }

    tick();

    return () => {
      cancelled = true;
      if (pollTimeoutId) clearTimeout(pollTimeoutId);
      if (readyTimeoutId) clearTimeout(readyTimeoutId);
    };
  }, [agentId]);

  const status = agent?.status || 'creating';

  // Render gating: only show when we're actively creating, briefly confirming
  // ready, in a failed state, or timed-out-but-still-creating. Anything else
  // (including post-fade ready) hides the banner entirely.
  const shouldRender =
    status === 'creating' ||
    status === 'failed' ||
    showReadyConfirmation ||
    timedOut;
  if (!shouldRender) return null;

  // Failed: tap to re-author the agent.
  if (status === 'failed') {
    return (
      <TouchableOpacity
        style={[bannerStyles.bar, bannerStyles.barFailed]}
        onPress={() => router.replace('/profile-setup')}
        activeOpacity={0.7}
      >
        <View style={[bannerStyles.dot, bannerStyles.dotFailed]} />
        <View style={bannerStyles.textBlock}>
          <Text style={[bannerStyles.textHi, bannerStyles.textFailed]}>
            Setup nahi ho paaya. Re-create karein →
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Ready confirmation: green check, fades after 3s.
  if (showReadyConfirmation) {
    const name = (agent?.name || '').trim() || 'Aapka assistant';
    return (
      <TouchableOpacity
        style={[bannerStyles.bar, bannerStyles.barReady]}
        onPress={() => router.push(`/agent-preview/${agentId}`)}
        activeOpacity={0.7}
      >
        <View style={[bannerStyles.dot, bannerStyles.dotReady]} />
        <View style={bannerStyles.textBlock}>
          <Text style={[bannerStyles.textHi, bannerStyles.textReady]}>
            ✓ {name} taiyaar hai
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Timed-out-but-still-creating: keep the muted strip but swap copy so the
  // user knows we've given up on the live updates without giving up on them.
  if (timedOut) {
    return (
      <TouchableOpacity
        style={bannerStyles.bar}
        onPress={() => router.push(`/agent-preview/${agentId}`)}
        activeOpacity={0.7}
      >
        <ActivityIndicator size="small" color={COLORS.textSecondary} />
        <View style={bannerStyles.textBlock}>
          <Text style={bannerStyles.textHi}>Setup background mein chal raha hai</Text>
          <Text style={bannerStyles.textEn}>Taking longer than expected</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // Creating: spinner + bilingual stack matched to the current stage.
  const rawStage = agent?.creationStage;
  const stage: BannerStage =
    rawStage && rawStage !== 'ready' ? (rawStage as BannerStage) : 'parsing';
  const copy = BANNER_STAGE_COPY[stage] || BANNER_STAGE_COPY.parsing;

  return (
    <TouchableOpacity
      style={bannerStyles.bar}
      onPress={() => router.push(`/agent-preview/${agentId}`)}
      activeOpacity={0.7}
    >
      <ActivityIndicator size="small" color={COLORS.textSecondary} />
      <View style={bannerStyles.textBlock}>
        <Text style={bannerStyles.textHi}>{copy.hi}</Text>
        <Text style={bannerStyles.textEn}>{copy.en}</Text>
      </View>
    </TouchableOpacity>
  );
}

const bannerStyles = StyleSheet.create({
  // Thin horizontal strip. Sits flush above the tab row — no outer borders /
  // shadows, just a 0.5px hairline at the bottom.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.statusMuteBg,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderSoft,
  },
  barReady: {
    backgroundColor: COLORS.statusCommittedBg,
  },
  barFailed: {
    backgroundColor: COLORS.statusDeclinedBg,
  },
  // Static dot used in ready / failed states (replaces the spinner).
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotReady: {
    backgroundColor: COLORS.statusCommittedFg,
  },
  dotFailed: {
    backgroundColor: COLORS.statusDeclinedFg,
  },
  textBlock: {
    flex: 1,
    gap: 1,
  },
  textHi: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 16,
  },
  textEn: {
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 14,
    opacity: 0.7,
  },
  textReady: {
    color: COLORS.statusCommittedFg,
  },
  textFailed: {
    color: COLORS.statusDeclinedFg,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen

export default function ContactImportScreen() {
  const router = useRouter();
  // Both query params are optional now:
  //
  //   - agentId — when present, the screen offers BOTH "Save contacts" and
  //     "Call them now" CTAs (the latter launches a campaign for that
  //     agent). When absent, only the Save flow runs (the user is just
  //     adding contacts to their library, no campaign), matching the
  //     /(tabs)/contacts entry where there's no agent in scope yet.
  //
  //   - mode — picks which of the 4 input tabs is active on first paint.
  //     Lets the Contacts tab's per-mode buttons deep-link straight into
  //     "voice" or "photo" without an extra tap. Defaults to 'paste'.
  const { agentId, mode: requestedMode } = useLocalSearchParams<{
    agentId?: string;
    mode?: string;
  }>();

  // Phase: 'input' is the 4-mode picker, 'review' is the parsed-list editor.
  const [phase, setPhase] = useState<'input' | 'review'>('input');
  const [mode, setMode] = useState<Mode>(() => {
    const valid: Mode[] = ['paste', 'photo', 'voice', 'contacts'];
    return (valid as readonly string[]).includes(requestedMode || '')
      ? (requestedMode as Mode)
      : 'paste';
  });

  // ── Paste state ──────────────────────────────────────────────────────────
  const [pasteText, setPasteText] = useState('');

  // ── Photo state ──────────────────────────────────────────────────────────
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string | null>(null);

  // ── Voice state ──────────────────────────────────────────────────────────
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Loading / error ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Review state ─────────────────────────────────────────────────────────
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [defaultVars, setDefaultVars] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<SkippedLine[]>([]);

  // ── Validate state (runs once on entry to review) ────────────────────────
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateErrorCode, setValidateErrorCode] = useState<string | null>(null);

  // ── Save state (decoupled from launch) ───────────────────────────────────
  const [saving, setSaving] = useState(false);

  // ── Phone-contacts picker state (in-app multi-select) ────────────────────
  // expo-contacts 15 ships `presentContactPickerAsync`, but it's a SINGLE-pick
  // affordance — we want multi-select, so we render our own checklist modal
  // over loadDeviceContacts() instead.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerSearch, setPickerSearch] = useState('');

  // Cleanup: stop any in-flight recording timer if the screen unmounts.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // Validate runs once, when we transition into review with a non-empty list.
  // Re-firing on every rows-change would be wasteful — the agent itself
  // hasn't changed, only the parsed list has.
  useEffect(() => {
    if (phase !== 'review' || !agentId) return;
    let cancelled = false;
    (async () => {
      setValidating(true);
      setValidateError(null);
      setValidateErrorCode(null);
      try {
        const raw = await api.post<any>(`/agents/${agentId}/validate`, {});
        if (cancelled) return;
        const env = readEnvelope<ValidateData>(raw);
        if (env.ok && env.data?.valid) {
          setValid(true);
        } else {
          setValid(false);
          // Surface the bilingual hint verbatim. Code lets us pick the right
          // recovery link ("Re-create" for missing-config errors, "Try again"
          // for transient ones).
          setValidateError(env.hint || raw?.errors?.[0]?.hint || 'Agent is not ready.');
          setValidateErrorCode(raw?.errors?.[0]?.code || null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setValid(false);
        setValidateError(err?.message || 'Could not check agent status.');
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, agentId]);

  // ───────────────────────────────────────────────────────────────────────
  // Shared: take a parse-notes / parse-image response and seed review state.
  const ingestParseResponse = (res: ParseResponse | null | undefined) => {
    const list = (res?.contacts ?? res?.rows ?? []).map<EditableRow>((r) => ({
      name: r.name || '',
      phone: r.phone || '',
      variables: r.variables || {},
    }));
    setRows(list);
    setDefaultVars(res?.defaultVariables || {});
    setSkipped(Array.isArray(res?.skipped) ? res!.skipped! : []);
    // Reset prior validate result — review remount will re-fire the check.
    setValid(null);
    setValidateError(null);
    setValidateErrorCode(null);
    setPhase('review');
  };

  // ───────────────────────────────────────────────────────────────────────
  // Mode 1: paste
  const submitPaste = async () => {
    const text = pasteText.trim();
    if (text.length < 3) {
      Alert.alert(
        'Text chahiye',
        'List paste karein — kuch toh likha ho.\n\nWe need some text — paste your list first.',
      );
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<ParseResponse>('/onboarding/parse-notes', {
        text,
        language: 'hinglish',
      });
      ingestParseResponse(res);
    } catch (err: any) {
      Alert.alert(
        'Could not read list',
        err?.message || 'Server rejected the parse. Try a smaller chunk.',
      );
    } finally {
      setLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Mode 2: photo
  const pickPhoto = async (source: 'camera' | 'library') => {
    // Lazy-load expo-image-picker so a dev-client without it doesn't crash on
    // import — same defensive pattern used by src/services/contactImport.ts.
    // Typed as `any` because expo-image-picker may not be present at static
    // check time on a fresh clone (added to package.json in this PR).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ImagePicker: any;
    try {
      ImagePicker = await import('expo-image-picker');
    } catch (err) {
      Alert.alert(
        'Image picker unavailable',
        'Photo mode needs a dev-client rebuild. Run `npx expo run:android` (or your EAS dev build) once and try again.',
      );
      return;
    }

    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          source === 'camera'
            ? 'Camera permission denied — enable it in Settings to take photos.'
            : 'Photos permission denied — enable it in Settings to pick from your gallery.',
        );
        return;
      }

      // expo-image-picker 16+ deprecated `MediaTypeOptions` in favour of an
      // array of media-type strings. Support both via a runtime check so a
      // version mismatch in the dev-client doesn't crash the screen.
      const mediaTypes =
        ImagePicker.MediaTypeOptions?.Images ?? ['images'];

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes,
              quality: 0.7,
              base64: true,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes,
              quality: 0.7,
              base64: true,
            });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setPhotoUri(asset.uri);
      setPhotoMime(asset.mimeType || 'image/jpeg');

      // Some platforms / picker versions don't return base64 inline. Fall back
      // to reading the file URI as base64 ourselves so the upload contract is
      // identical regardless of mode.
      if (asset.base64) {
        setPhotoBase64(asset.base64);
      } else {
        try {
          const b64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setPhotoBase64(b64);
        } catch (err: any) {
          Alert.alert('Could not read image', err?.message || 'Try a different photo.');
          setPhotoUri(null);
          setPhotoBase64(null);
          setPhotoMime(null);
        }
      }
    } catch (err: any) {
      Alert.alert('Photo failed', err?.message || 'Try again.');
    }
  };

  const submitPhoto = async () => {
    if (!photoBase64 || !photoMime) {
      Alert.alert('Photo chahiye', 'Pick or take a photo first.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<ParseResponse>('/onboarding/parse-image', {
        imageBase64: photoBase64,
        mimeType: photoMime,
        language: 'hinglish',
      });
      ingestParseResponse(res);
    } catch (err: any) {
      Alert.alert(
        'Could not read photo',
        err?.message || 'Try a clearer photo or a different lighting.',
      );
    } finally {
      setLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Mode 3: voice (transcribe → parse, two network hops, one progress bar)
  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Mic access needed',
          'Microphone permission denied — enable it in Settings to dictate your list.',
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
            // Auto-stop on the cap.
            setTimeout(() => stopRecordingAndProcess(), 0);
          }
          return next;
        });
      }, 1000);
    } catch (err: any) {
      Alert.alert('Could not start recording', err?.message || 'Try again.');
      setIsRecording(false);
    }
  };

  const stopRecordingAndProcess = async () => {
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
      Alert.alert('Recording failed', err?.message || 'Please try again.');
      return;
    }
    if (!fileUri) {
      Alert.alert('Recording failed', 'No audio was captured. Please try again.');
      return;
    }
    if (elapsed < MIN_RECORDING_SECONDS) {
      Alert.alert(
        'Bahut chhota recording',
        'That recording was too short. Try again — speak naturally for a few seconds.',
      );
      return;
    }

    setLoading(true);
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Step 1: transcribe.
      const transcript = await api.post<TranscribeResponse>('/onboarding/transcribe', {
        audio: audioBase64,
        filename: 'contacts-dictation.m4a',
        language: 'unknown',
      });
      const text = (transcript.text || '').trim();
      if (!text) {
        Alert.alert(
          "Couldn't hear you clearly",
          'Try again — speak a bit louder or move somewhere quieter.',
        );
        return;
      }

      // Step 2: parse the transcript exactly like the paste flow.
      const parsed = await api.post<ParseResponse>('/onboarding/parse-notes', {
        text,
        language: 'hinglish',
      });
      ingestParseResponse(parsed);
    } catch (err: any) {
      Alert.alert(
        'Could not process recording',
        err?.message || 'Try again, or use Paste / Photo instead.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceTap = () => {
    if (loading) return;
    if (isRecording) {
      void stopRecordingAndProcess();
    } else {
      void startRecording();
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Mode 4: phone contacts picker (in-app multi-select).
  //
  // The OS-native `Contacts.presentContactPickerAsync()` is single-select; we
  // need multi-select for "import N people at once", so we read the address
  // book ourselves and render a checklist modal over loadDeviceContacts().
  //
  // openContactsPicker
  //   1. asks for permission (handled inside loadDeviceContacts)
  //   2. on grant: stores the device contacts and opens the modal
  //   3. on deny:  Alert with a Settings deep-link
  //   4. on unavailable (dev-client missing native module): Alert with rebuild hint
  const openContactsPicker = async () => {
    setPickerLoading(true);
    setPickerOpen(true);
    try {
      const res = await loadDeviceContacts();
      if (!res.ok) {
        setPickerOpen(false);
        if (res.reason === 'denied') {
          Alert.alert(
            'Permission needed',
            'MakeMyCall needs permission to read your contacts. Open Settings to enable it.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => {
                  void Linking.openSettings();
                },
              },
            ],
          );
        } else {
          Alert.alert('Could not open contacts', res.message);
        }
        return;
      }
      if (res.contacts.length === 0) {
        setPickerOpen(false);
        Alert.alert(
          'Phone book khali hai',
          'No contacts with phone numbers found on this device.',
        );
        return;
      }
      setDeviceContacts(res.contacts);
      setPickerSelected(new Set());
      setPickerSearch('');
    } catch (err: any) {
      setPickerOpen(false);
      Alert.alert('Contacts import failed', err?.message || 'Try again.');
    } finally {
      setPickerLoading(false);
    }
  };

  const togglePickerContact = (id: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredDeviceContacts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return deviceContacts;
    return deviceContacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [deviceContacts, pickerSearch]);

  const confirmContactsPicker = async () => {
    const picks = deviceContacts.filter((c) => pickerSelected.has(c.id));
    if (picks.length === 0) {
      Alert.alert('Pick at least one', 'Tap the contacts you want to import.');
      return;
    }
    setPickerOpen(false);
    setLoading(true);
    try {
      // We could send picks straight into review without parse-notes — they're
      // already structured. But parse-notes also tags default variables and
      // detects intent, which the other modes get for free. Keep parity.
      const text = picks.map((c) => `${c.name} ${c.phone}`).join('\n');
      const parsed = await api.post<ParseResponse>('/onboarding/parse-notes', {
        text,
        language: 'hinglish',
      });
      const list = parsed?.contacts ?? parsed?.rows ?? [];
      if (list.length === 0) {
        ingestParseResponse({
          contacts: picks.map((c) => ({
            name: c.name,
            phone: c.phone,
            variables: {},
          })),
          defaultVariables: {},
          skipped: [],
        });
      } else {
        ingestParseResponse(parsed);
      }
    } catch (err: any) {
      // Even if parse-notes fails, we still have a structured list — fall back
      // so the user doesn't lose their selection.
      ingestParseResponse({
        contacts: picks.map((c) => ({
          name: c.name,
          phone: c.phone,
          variables: {},
        })),
        defaultVariables: {},
        skipped: [],
      });
    } finally {
      setLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Review-screen helpers

  const updateRow = (idx: number, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const deleteRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };
  const appendRow = (row: EditableRow) => {
    setRows((prev) => [...prev, row]);
  };

  const validRowCount = useMemo(
    () => rows.filter((r) => normalisePhone(r.phone).length >= 10).length,
    [rows],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Save (primary path) — persists contacts to the address book and routes
  // home. Decoupled from agent readiness: saving works regardless of whether
  // the agent is `creating`, `ready`, or `failed`. This is the user's new
  // default — they can come back later and launch a campaign once the agent
  // is ready.
  //
  // Shape: POST /contacts/bulk { contacts: [{name, phone, customFields}] }
  // (Same shape app/(tabs)/contacts.tsx::submitImport already uses.) defaultVars
  // are merged into each contact's customFields so per-contact values win, with
  // defaults filling the gaps — matching the launch flow's default-merge intent.
  const saveContacts = async () => {
    if (rows.length === 0) {
      Alert.alert('No contacts', 'Add at least one contact before saving.');
      return;
    }

    const validRows = rows.filter((r) => normalisePhone(r.phone).length >= 10);
    if (validRows.length === 0) {
      Alert.alert(
        'Phone numbers missing',
        'Each contact needs a 10-digit phone. Tap a row to fix.',
      );
      return;
    }
    if (validRows.length < rows.length) {
      const dropped = rows.length - validRows.length;
      const ok = await confirm(
        `${dropped} row${dropped === 1 ? '' : 's'} skipped`,
        `${dropped} contact${dropped === 1 ? ' has' : 's have'} no valid phone and will be skipped. Continue?`,
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const payload = validRows.map((r) => {
        // Merge: defaultVars first, per-row variables overwrite. Same precedence
        // as the launch flow so a row-level "amount = 1500" beats a default.
        const customFields: Record<string, string> = { ...(defaultVars || {}) };
        for (const [k, v] of Object.entries(r.variables || {})) {
          if (v && String(v).trim()) customFields[k] = v;
        }
        return {
          name: (r.name || '').trim() || 'Unknown',
          phone: normalisePhone(r.phone),
          customFields,
        };
      });

      const res = await api.post<{
        created?: any[];
        createdCount?: number;
        skippedCount?: number;
      }>('/contacts/bulk', { contacts: payload });

      const created = res?.createdCount ?? res?.created?.length ?? payload.length;
      const skipped = res?.skippedCount ?? 0;
      // Native Alert chosen over an in-app toast: there's no existing toast
      // primitive in this app, and Alert is the established success-confirmation
      // pattern (see /(tabs)/contacts.tsx submitImport, which also Alerts on
      // bulk-import success). Keeps the surface consistent.
      Alert.alert(
        '✓ Contacts saved',
        `${created} contact${created === 1 ? '' : 's'} added` +
          (skipped ? `, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''),
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)'),
          },
        ],
      );
    } catch (err: any) {
      Alert.alert('Could not save contacts', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Launch — single-shot replacement for /contacts/bulk → /contacts → /campaigns.
  // The new endpoint accepts raw {name, phone, variables} contacts and returns
  // the campaign id directly. On 200 / success=false we surface the hint and
  // stay; on a network throw we Alert as before.
  const launchCampaign = async () => {
    if (!agentId) {
      Alert.alert('Missing agent', 'Could not find your assistant. Go back and try again.');
      return;
    }
    if (rows.length === 0) {
      Alert.alert('No contacts', 'Add at least one contact before calling.');
      return;
    }

    const validRows = rows.filter((r) => normalisePhone(r.phone).length >= 10);
    if (validRows.length === 0) {
      Alert.alert(
        'Phone numbers missing',
        'Each contact needs a 10-digit phone. Tap a row to fix.',
      );
      return;
    }
    if (validRows.length < rows.length) {
      const dropped = rows.length - validRows.length;
      const ok = await confirm(
        `${dropped} row${dropped === 1 ? '' : 's'} skipped`,
        `${dropped} contact${dropped === 1 ? ' has' : 's have'} no valid phone and will be skipped. Continue?`,
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const raw = await api.post<any>(`/agents/${agentId}/launch`, {
        contacts: validRows.map((r) => ({
          name: (r.name || '').trim() || 'Unknown',
          phone: normalisePhone(r.phone),
          variables: r.variables || {},
        })),
        defaultVariables: defaultVars || {},
      });
      const env = readEnvelope<LaunchData>(raw);
      if (env.ok && env.data?.campaign?.id) {
        // Same destination as the wizard's launch flow — the campaign detail
        // screen polls and shows per-call status.
        router.replace(`/campaigns/${env.data.campaign.id}`);
        return;
      }
      // 200 with success=false (insufficient credits, agent not ready, etc.)
      Alert.alert('Launch failed', env.hint || 'Could not launch the campaign.');
    } catch (err: any) {
      Alert.alert('Could not launch calls', err?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Render

  if (phase === 'review') {
    return (
      <ReviewView
        rows={rows}
        defaultVars={defaultVars}
        skipped={skipped}
        validCount={validRowCount}
        submitting={submitting}
        saving={saving}
        validating={validating}
        valid={valid}
        validateError={validateError}
        validateErrorCode={validateErrorCode}
        agentId={agentId}
        onUpdate={updateRow}
        onDelete={deleteRow}
        onAppend={appendRow}
        onBack={() => setPhase('input')}
        onSave={saveContacts}
        onLaunch={launchCampaign}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Live agent-creation banner — only renders when agentId is present and
          the agent is in a non-terminal state (or briefly confirming ready /
          failed). Sits above the scroll so it's always visible while the user
          works on their list. */}
      {agentId ? <AgentCreationBanner agentId={agentId} /> : null}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back chevron — sits above the tab row in input state. The screen has
            no Stack header, so we render a plain TouchableOpacity. From input,
            back routes to the home dashboard (the user came in via /agents/new
            or the onboarding wizard, both of which lead back to /(tabs)). */}
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)')}
          hitSlop={12}
          style={styles.backChevron}
        >
          <Feather name="chevron-left" size={16} color={COLORS.text} />
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Add your contacts</Text>
          <Text style={styles.subtitle}>
            47 students ke parents ko call karna hai
          </Text>
        </View>

        {/* Mode tabs */}
        <View style={styles.tabRow}>
          <ModeTab
            active={mode === 'paste'}
            iconName="clipboard"
            label="Paste"
            onPress={() => setMode('paste')}
            disabled={loading}
          />
          <ModeTab
            active={mode === 'photo'}
            iconName="camera"
            label="Photo"
            onPress={() => setMode('photo')}
            disabled={loading}
          />
          <ModeTab
            active={mode === 'voice'}
            iconName="mic"
            label="Voice"
            onPress={() => setMode('voice')}
            disabled={loading || isRecording}
          />
          <ModeTab
            active={mode === 'contacts'}
            iconName="smartphone"
            label="Phone"
            onPress={() => setMode('contacts')}
            disabled={loading}
          />
        </View>

        {/* Mode panel */}
        <View style={styles.panel}>
          {mode === 'paste' && (
            <>
              <TextInput
                style={styles.textarea}
                multiline
                numberOfLines={10}
                placeholder={PASTE_PLACEHOLDER}
                placeholderTextColor={COLORS.textMuted}
                value={pasteText}
                onChangeText={setPasteText}
                textAlignVertical="top"
                editable={!loading}
              />
              <Text style={styles.helper}>
                Paste your list — handwritten format, WhatsApp se copy, kuch bhi.
              </Text>
              <PrimaryButton
                label="Continue → review"
                onPress={submitPaste}
                disabled={loading || pasteText.trim().length < 3}
                loading={loading}
              />
            </>
          )}

          {mode === 'photo' && (
            <>
              {photoUri ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                  <TouchableOpacity
                    onPress={() => {
                      setPhotoUri(null);
                      setPhotoBase64(null);
                      setPhotoMime(null);
                    }}
                    style={styles.photoClear}
                    hitSlop={10}
                  >
                    <Text style={styles.photoClearText}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.photoSlot}>
                  <Feather name="camera" size={40} color={COLORS.textSecondary} />
                  <Text style={styles.photoSlotText}>
                    Register ki photo / kheech ke daalo
                  </Text>
                </View>
              )}
              <Text style={styles.helper}>
                Notebook ya register ki photo — hum naam aur number nikal lenge.
              </Text>
              <View style={styles.photoButtons}>
                <FilledButton
                  label="Take photo"
                  onPress={() => pickPhoto('camera')}
                  disabled={loading}
                  flex
                />
                <OutlinedButton
                  label="From gallery"
                  onPress={() => pickPhoto('library')}
                  disabled={loading}
                  flex
                />
              </View>
              {photoUri && (
                <PrimaryButton
                  label="Continue → review"
                  onPress={submitPhoto}
                  disabled={loading || !photoBase64}
                  loading={loading}
                />
              )}
            </>
          )}

          {mode === 'voice' && (
            <View style={styles.voicePanel}>
              <TouchableOpacity
                style={styles.voiceMicButton}
                onPress={handleVoiceTap}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Feather name="mic" size={32} color={COLORS.danger} />
              </TouchableOpacity>
              {isRecording ? (
                <View style={styles.voiceTimerRow}>
                  <View style={styles.voiceRecDot} />
                  <Text style={styles.voiceTimer}>{formatTime(recordingSeconds)}</Text>
                </View>
              ) : null}
              <Text style={styles.voiceExample}>
                "Sharma ji ka number nau-aath-saat-chhe…"
              </Text>
              <Text style={styles.voiceHelper}>
                {loading
                  ? 'Working…'
                  : isRecording
                    ? `Tap to stop · ${MAX_RECORDING_SECONDS - recordingSeconds}s left`
                    : `Tap to record · max ${MAX_RECORDING_SECONDS}s`}
              </Text>
            </View>
          )}

          {mode === 'contacts' && (
            <>
              <View style={styles.contactsHero}>
                <View style={styles.contactsIconCircle}>
                  <Feather name="users" size={30} color={COLORS.ink} />
                </View>
                <Text style={styles.contactsTitle}>Phone contacts kholo</Text>
                <Text style={styles.contactsSubtitle}>
                  Pull from your phone — review on the next screen.
                </Text>
              </View>
              <PrimaryButton
                label="Open phone contacts"
                onPress={openContactsPicker}
                disabled={loading || pickerLoading}
                loading={loading || pickerLoading}
              />
            </>
          )}
        </View>

        {/* Loading overlay (per-mode loading state) */}
        {loading && mode !== 'contacts' && (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={COLORS.ink} />
            <Text style={styles.loadingText}>
              List samajh raha hoon… Reading your list…
            </Text>
          </View>
        )}
      </ScrollView>

      {/* In-app contacts picker — multi-select checklist over the device's
          address book. Mirrors the modal pattern used in app/(tabs)/contacts.tsx.
          We render our own instead of expo-contacts' presentContactPickerAsync
          because that's single-select. */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
        transparent={false}
      >
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={10}>
              <Text style={styles.pickerCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>Pick contacts</Text>
            <TouchableOpacity
              onPress={confirmContactsPicker}
              hitSlop={10}
              disabled={pickerSelected.size === 0}
            >
              <Text
                style={[
                  styles.pickerDone,
                  pickerSelected.size === 0 && styles.pickerDoneDisabled,
                ]}
              >
                Done{pickerSelected.size > 0 ? ` (${pickerSelected.size})` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {pickerLoading ? (
            <View style={styles.pickerCenter}>
              <ActivityIndicator size="large" color={COLORS.ink} />
              <Text style={styles.pickerLoadingText}>Reading your phone book…</Text>
            </View>
          ) : (
            <>
              <View style={styles.pickerSearchRow}>
                <TextInput
                  style={styles.pickerSearchInput}
                  placeholder="Search by name or number"
                  placeholderTextColor={COLORS.textMuted}
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                />
              </View>

              {filteredDeviceContacts.length === 0 ? (
                <View style={styles.pickerCenter}>
                  <Text style={styles.pickerEmptyTitle}>No matches</Text>
                  <Text style={styles.pickerEmptyText}>
                    Try a different search.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filteredDeviceContacts}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.pickerList}
                  renderItem={({ item }) => {
                    const picked = pickerSelected.has(item.id);
                    return (
                      <TouchableOpacity
                        style={[
                          styles.pickerRow,
                          picked && styles.pickerRowPicked,
                        ]}
                        onPress={() => togglePickerContact(item.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.pickerRowText}>
                          <Text style={styles.pickerRowName}>{item.name}</Text>
                          <Text style={styles.pickerRowPhone}>{item.phone}</Text>
                        </View>
                        <View
                          style={[
                            styles.pickerCheck,
                            picked && styles.pickerCheckPicked,
                          ]}
                        >
                          {picked && (
                            <Feather name="check" size={14} color={COLORS.textOnInk} />
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review sub-view
//
// Kept as a sub-component (still in this file) so the input screen above
// stays focused on input, and so the review state-machine doesn't muddle
// with mode-tab state. Inline editing happens in-place; delete is a single
// tap with no confirmation (the bottom CTA confirms intent for the whole batch).

function ReviewView(props: {
  rows: EditableRow[];
  defaultVars: Record<string, string>;
  skipped: SkippedLine[];
  validCount: number;
  submitting: boolean;
  saving: boolean;
  validating: boolean;
  valid: boolean | null;
  validateError: string | null;
  validateErrorCode: string | null;
  agentId: string | undefined;
  onUpdate: (idx: number, patch: Partial<EditableRow>) => void;
  onDelete: (idx: number) => void;
  onAppend: (row: EditableRow) => void;
  onBack: () => void;
  onSave: () => void;
  onLaunch: () => void;
}) {
  const router = useRouter();
  const {
    rows,
    defaultVars,
    skipped,
    validCount,
    submitting,
    saving,
    validating,
    valid,
    validateError,
    validateErrorCode,
    agentId,
    onUpdate,
    onDelete,
    onAppend,
    onBack,
    onSave,
    onLaunch,
  } = props;
  const total = rows.length;
  const defaultEntries = Object.entries(defaultVars).filter(([, v]) => v && String(v).trim());

  // Error codes that imply "the agent itself is broken — re-author it" vs.
  // transient codes ("try again in a moment"). Codes are the lowercase
  // strings emitted by the backend's validateAgent helper in
  // api/services/Agent.js — keep these in sync.
  const RECREATE_CODES = new Set([
    'agent_no_phone',
    'agent_variables_missing',
    'agent_not_provisioned',
  ]);
  const showRecreate = validateErrorCode && RECREATE_CODES.has(validateErrorCode);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back chevron — review state goes back to input (re-do import). */}
        <TouchableOpacity
          onPress={onBack}
          hitSlop={12}
          style={styles.backChevron}
        >
          <Feather name="chevron-left" size={16} color={COLORS.text} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>{total} contacts mile</Text>
        </View>

        {/* Default-variable chip */}
        {defaultEntries.length > 0 && (
          <View style={styles.defaultChipWrap}>
            <View style={styles.defaultChip}>
              <Text style={styles.defaultChipLabel}>
                Default: {defaultEntries.map(([k, v]) => `${k} = ${v}`).join(', ')} sab par lagega
              </Text>
            </View>
          </View>
        )}

        {/* Rows */}
        {rows.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>Kuch nahi mila</Text>
            <Text style={styles.emptyText}>
              Try a different mode — paste, photo, or voice.
            </Text>
            <TouchableOpacity style={styles.outlinedBtn} onPress={onBack}>
              <Text style={styles.outlinedBtnText}>← Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginTop: 4 }}>
            {rows.map((row, idx) => (
              <ReviewRow
                key={idx}
                row={row}
                idx={idx}
                submitting={submitting}
                onUpdate={onUpdate}
                onDelete={onDelete}
              />
            ))}
          </View>
        )}

        {/* Skipped */}
        {skipped.length > 0 && (
          <View style={styles.skippedSection}>
            <Text style={styles.skippedSectionLabel}>
              Inhe samajh nahi paaya — theek karein?
            </Text>
            {skipped.map((s, i) => (
              <View key={i} style={styles.skippedRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.skippedLine}>{s.line}</Text>
                  {s.reason ? (
                    <Text style={styles.skippedReason}>{s.reason}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.fixBtn}
                  onPress={() => {
                    // Append the original line into a fresh editable row so
                    // the user can split out the name / phone manually. Simpler
                    // than a dedicated mini-editor for v1.
                    onAppend({ name: s.line, phone: '', variables: {} });
                  }}
                  disabled={submitting}
                >
                  <Text style={styles.fixBtnText}>Fix</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* CTAs: primary "Save kar lein" (decoupled from agent state) + secondary
            "Abhi call karein" (gated on validate). The save path is now the
            default — saving contacts has nothing to do with whether the agent
            is ready, so the validate result NEVER blocks save. The validate
            banner, when surfaced, only sits above the secondary call button
            and only its enabled-state hangs on `valid === true`. */}
        {rows.length > 0 && (
          <>
            {/* PRIMARY: Save kar lein / Save and finish. Bilingual stack matches
                the pre-existing ctaTextHi/ctaTextEn pattern used by the launch
                CTA. Disabled only on no-valid-rows or in-flight save/submit. */}
            <TouchableOpacity
              style={[
                styles.cta,
                (saving || submitting || validCount === 0) && styles.ctaDisabled,
              ]}
              onPress={onSave}
              disabled={saving || submitting || validCount === 0}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.textOnInk} />
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.ctaTextHi}>Save kar lein</Text>
                  <Text style={styles.ctaTextEn}>Save and finish</Text>
                </View>
              )}
            </TouchableOpacity>
            {validCount < total && (
              <Text style={styles.ctaFoot}>
                {total - validCount} row{total - validCount === 1 ? '' : 's'} without a phone will be skipped.
              </Text>
            )}

            {/* Validate banner — only surfaces if validate failed. Only gates
                the secondary "Call now" button below; the save above is unaffected. */}
            {valid === false && validateError ? (
              <View style={styles.validateBanner}>
                <Text style={styles.validateBannerText}>{validateError}</Text>
                <TouchableOpacity
                  style={styles.validateRetryBtn}
                  onPress={() => {
                    if (showRecreate && agentId) {
                      router.push(`/agent-preview/${agentId}`);
                    } else {
                      // Soft re-fire: bounce out and back into review to retry validate.
                      onBack();
                    }
                  }}
                >
                  <Text style={styles.validateRetryText}>
                    {showRecreate ? 'Re-create' : 'Try again'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* SECONDARY: Abhi call karein / Call them now. Only shown
                when an agentId was provided (campaign-launch context). In
                the standalone add-contacts entry from the Contacts tab,
                no agent is in scope and "Save kar lein" above is the only
                action — campaigns get launched later from per-agent cards
                on the home screen. */}
            {agentId ? (
              <TouchableOpacity
                style={[
                  styles.secondaryCta,
                  (validating || submitting || saving || valid !== true || validCount === 0) &&
                    styles.secondaryCtaDisabled,
                ]}
                onPress={onLaunch}
                disabled={
                  validating || submitting || saving || valid !== true || validCount === 0
                }
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color={COLORS.ink} />
                ) : validating ? (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.secondaryCtaTextHi}>Checking…</Text>
                    <Text style={styles.secondaryCtaTextEn}>Verifying agent</Text>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.secondaryCtaTextHi}>Abhi call karein</Text>
                    <Text style={styles.secondaryCtaTextEn}>
                      Call {validCount} now
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Atoms

function ReviewRow({
  row,
  idx,
  submitting,
  onUpdate,
  onDelete,
}: {
  row: EditableRow;
  idx: number;
  submitting: boolean;
  onUpdate: (idx: number, patch: Partial<EditableRow>) => void;
  onDelete: (idx: number) => void;
}) {
  // Inline edit state: tap a row to expand into name/phone TextInputs. Saves
  // surface area when the parse is correct, which is the common case.
  const [expanded, setExpanded] = useState(false);
  const phoneOk = normalisePhone(row.phone).length >= 10;

  if (!expanded) {
    return (
      <TouchableOpacity
        style={styles.reviewRowCompact}
        onPress={() => setExpanded(true)}
        activeOpacity={0.7}
        disabled={submitting}
      >
        <Text style={styles.reviewName} numberOfLines={1}>
          {row.name?.trim() || 'No name'}
        </Text>
        <Text
          style={[styles.reviewPhone, !phoneOk && styles.reviewPhoneBad]}
          numberOfLines={1}
        >
          {row.phone || '—'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.reviewRowExpanded}>
      <View style={{ flex: 1, gap: 6 }}>
        <TextInput
          style={styles.reviewInput}
          placeholder="Name"
          placeholderTextColor={COLORS.textMuted}
          value={row.name}
          onChangeText={(v) => onUpdate(idx, { name: v })}
          editable={!submitting}
          onBlur={() => setExpanded(false)}
          autoFocus
        />
        <TextInput
          style={[styles.reviewInput, styles.reviewInputPhone, !phoneOk && styles.reviewInputBad]}
          placeholder="Phone (10 digits)"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="phone-pad"
          value={row.phone}
          onChangeText={(v) => onUpdate(idx, { phone: v })}
          editable={!submitting}
        />
      </View>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => onDelete(idx)}
        disabled={submitting}
        hitSlop={10}
      >
        <Text style={styles.deleteBtnText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

function ModeTab({
  active,
  iconName,
  label,
  onPress,
  disabled,
}: {
  active: boolean;
  iconName: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const fg = active ? COLORS.textOnInk : COLORS.textSecondary;
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive, disabled && styles.tabDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Feather name={iconName} size={16} color={fg} />
      <Text style={[styles.tabLabel, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.cta, disabled && styles.ctaDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.textOnInk} />
      ) : (
        <Text style={styles.ctaText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function FilledButton({
  label,
  onPress,
  disabled,
  flex,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  flex?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.filledBtn, flex && { flex: 1 }, disabled && styles.ctaDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={styles.filledBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function OutlinedButton({
  label,
  onPress,
  disabled,
  flex,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  flex?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.outlinedBtn, flex && { flex: 1 }, disabled && styles.ctaDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={styles.outlinedBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function normalisePhone(s: string): string {
  return (s || '').replace(/\D/g, '');
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ]);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingTop: 56, paddingBottom: 60 },

  header: { marginBottom: 16 },
  back: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 12,
    fontWeight: '500',
  },
  // Top-of-content chevron back button. Sits above the tab row in input state
  // and above the title in review state. No native Stack header on this screen
  // so we render a plain icon TouchableOpacity at content-pad alignment.
  backChevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '500', color: COLORS.ink, lineHeight: 24 },
  subtitle: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, lineHeight: 17 },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: COLORS.statusMuteBg,
    alignItems: 'center',
    gap: 10,
  },
  tabActive: {
    backgroundColor: COLORS.ink,
  },
  tabDisabled: { opacity: 0.5 },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Panel
  panel: { gap: 12 },

  // Helper text
  helper: {
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 16,
    marginTop: 4,
  },

  // Paste textarea
  textarea: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13,
    fontFamily: MONOSPACE,
    color: COLORS.ink,
    minHeight: 200,
    lineHeight: 19,
  },

  // Photo
  photoSlot: {
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.statusMuteBg,
    paddingVertical: 36,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  photoSlotText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  photoButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  photoPreviewWrap: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    position: 'relative',
  },
  photoPreview: { width: '100%', height: 220 },
  photoClear: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoClearText: {
    color: COLORS.textOnInk,
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 20,
  },

  // Voice
  voicePanel: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  voiceMicButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: COLORS.danger,
    backgroundColor: COLORS.statusDeclinedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  voiceRecDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
  },
  voiceTimer: {
    fontSize: 13,
    fontFamily: MONOSPACE,
    color: COLORS.ink,
    fontVariant: ['tabular-nums'],
  },
  voiceExample: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
    maxWidth: 200,
    marginTop: 6,
  },
  voiceHelper: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },

  // Phone-contacts mode
  contactsHero: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  contactsIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  contactsTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.ink,
  },
  contactsSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    maxWidth: 240,
  },

  // Buttons — filled (ink) primary, outlined secondary
  cta: {
    flexDirection: 'row',
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },
  ctaTextHi: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },
  ctaTextEn: {
    color: COLORS.textOnInk,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
    opacity: 0.7,
  },
  ctaFoot: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },

  filledBtn: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filledBtnText: {
    color: COLORS.textOnInk,
    fontSize: 13,
    fontWeight: '500',
  },
  outlinedBtn: {
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    backgroundColor: COLORS.surface,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  outlinedBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.ink,
  },

  // Loading card (per-mode parse-in-flight)
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.statusMuteBg,
    borderRadius: 8,
    padding: 13,
    marginTop: 18,
  },
  loadingText: { fontSize: 12, color: COLORS.textSecondary, flex: 1 },

  // ── Review screen ──────────────────────────────────────────────────────
  defaultChipWrap: { flexDirection: 'row', marginBottom: 12 },
  defaultChip: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  defaultChipLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.ink,
  },

  // Compact (collapsed) row — name on left, phone on right
  reviewRowCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.statusMuteBg,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 6,
    gap: 10,
  },
  reviewName: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.ink,
    flexShrink: 1,
  },
  reviewPhone: {
    fontSize: 12,
    fontFamily: MONOSPACE,
    color: COLORS.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  reviewPhoneBad: { color: COLORS.danger },

  // Expanded (editing) row
  reviewRowExpanded: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    padding: 10,
    marginBottom: 6,
    alignItems: 'center',
  },
  reviewInput: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: COLORS.ink,
    borderWidth: 0.5,
    borderColor: 'transparent',
  },
  reviewInputPhone: { fontFamily: MONOSPACE, fontVariant: ['tabular-nums'] },
  reviewInputBad: { borderColor: COLORS.danger },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 20,
    color: COLORS.textSecondary,
    fontWeight: '500',
    lineHeight: 22,
    marginTop: -2,
  },

  // Skipped section
  skippedSection: {
    marginTop: 10,
    gap: 6,
  },
  skippedSectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  skippedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.statusExtensionBg,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  skippedLine: {
    fontSize: 12,
    fontFamily: MONOSPACE,
    color: COLORS.statusExtensionFg,
    lineHeight: 17,
  },
  skippedReason: {
    fontSize: 11,
    color: COLORS.statusExtensionFg,
    opacity: 0.7,
    marginTop: 2,
    fontStyle: 'italic',
  },
  fixBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.statusExtensionFg,
    borderRadius: 8,
  },
  fixBtnText: {
    color: COLORS.textOnInk,
    fontSize: 11,
    fontWeight: '500',
  },

  // Validate banner — replaces the CTA when the agent isn't callable
  validateBanner: {
    backgroundColor: COLORS.statusDeclinedBg,
    borderRadius: 8,
    padding: 14,
    marginTop: 18,
    gap: 10,
  },
  validateBannerText: {
    fontSize: 12,
    color: COLORS.statusDeclinedFg,
    lineHeight: 18,
  },
  validateRetryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  validateRetryText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.statusDeclinedFg,
    textDecorationLine: 'underline',
  },

  // Empty state
  emptyBlock: { padding: 32, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '500', color: COLORS.ink },
  emptyText: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },

  // Secondary CTA — outlined, smaller, sits below the primary save button
  // and the validate banner (when present). Disabled state mirrors ctaDisabled.
  secondaryCta: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryCtaDisabled: { opacity: 0.4 },
  secondaryCtaTextHi: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '500',
  },
  secondaryCtaTextEn: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '400',
    marginTop: 2,
    opacity: 0.85,
  },

  // ── In-app contacts picker modal ───────────────────────────────────────
  pickerContainer: { flex: 1, backgroundColor: COLORS.background },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderSoft,
  },
  pickerTitle: { fontSize: 14, fontWeight: '500', color: COLORS.ink },
  pickerCancel: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' },
  pickerDone: { fontSize: 13, color: COLORS.ink, fontWeight: '600' },
  pickerDoneDisabled: { color: COLORS.textMuted, fontWeight: '500' },
  pickerSearchRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  pickerSearchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: COLORS.ink,
  },
  pickerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  pickerLoadingText: { fontSize: 12, color: COLORS.textSecondary },
  pickerEmptyTitle: { fontSize: 14, fontWeight: '500', color: COLORS.ink },
  pickerEmptyText: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  pickerList: { paddingHorizontal: 16, paddingBottom: 24 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    gap: 10,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
  },
  pickerRowPicked: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.ink,
  },
  pickerRowText: { flex: 1, gap: 2 },
  pickerRowName: { fontSize: 13, fontWeight: '500', color: COLORS.ink },
  pickerRowPhone: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontFamily: MONOSPACE,
    fontVariant: ['tabular-nums'],
  },
  pickerCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckPicked: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
});
