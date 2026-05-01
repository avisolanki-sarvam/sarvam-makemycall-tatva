/**
 * /agent-preview/[id]
 *
 * Single-screen stage checklist that polls GET /agents/:id every 2s and
 * surfaces progress as the BullMQ worker advances. Replaces the previous
 * multi-stage UX (each backend stage swapped the whole screen for a
 * different staged-loading layout: name reveal, language chips,
 * deploying medallion). One screen, one checklist — easier to grok and
 * matches the post-Apr-2026 mockups.
 *
 * Three entry modes via the optional `next` query param:
 *
 *   - `?next=home`     — entered from /agents/new (multi-agent flow).
 *     On ready, brief pause then router.replace('/(tabs)') so the new
 *     agent appears in the home agents list. The DEFAULT for newly-
 *     created agents in the multi-agent UX.
 *
 *   - `?next=campaign` — legacy entry from the home screen "Create
 *     campaign" tile (single-agent flow). On ready, route into
 *     /campaigns/new. Kept for backwards compatibility with any code
 *     paths that still pass this param.
 *
 *   - no param         — entered by tapping an existing agent card. On
 *     ready, show the full agent summary and a CTA stack so the user
 *     can review, test-call, or jump into the campaign wizard.
 *
 * onboardingDone is set HERE as a defensive backstop. It's primarily set
 * in profile-setup now (decoupled from agent creation), but flipping it
 * here too protects against old auth-store blobs from prior installs.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
// Use phosphor SVG icons everywhere — @expo/vector-icons (TTF font) keeps
// rendering as empty <Text /> until Font.loadAsync resolves, which crashes
// on stale dev clients via the FilePermissionService ABI mismatch. SVG
// icons sidestep the font path entirely.
import { CheckIcon } from 'phosphor-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';
import { TatvaIcon } from '../../src/components/TatvaIcon';

type PossibleOutcome = { key: string; label: string };
type ExtraField     = { field: string; reason: string; required?: boolean };

interface SummaryNL {
  whatItDoes?: string;
  howItTalks?: string;
  language?: string;
  possibleOutcomes?: PossibleOutcome[];
  requiredContactFields?: string[];
  suggestedExtraFields?: ExtraField[];
}

interface Agent {
  id: string;
  name: string;
  language: string;
  tone: string;
  industry: string | null;
  callTypes: string[];
  summaryNL: SummaryNL;
  createdAt: string;
  status?: 'creating' | 'ready' | 'failed';
  creationStage?: 'parsing' | 'designing' | 'translating' | 'deploying' | 'ready' | null;
  error?: string | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60s total

// Brief pause on the success state before auto-routing to /campaigns/new.
// Long enough for the user to register "ready", short enough to feel snappy.
const READY_HOLD_MS = 1500;

// Single source of truth for the stage list. Each entry is one row in the
// checklist; `gateStage` is the EARLIEST backend stage at which the row is
// considered "active or completed" — so as the worker advances, more rows
// flip from pending → active → done. The order MUST match the backend
// stage progression in api/services/Agent.js.
// labelKey / hintKey resolve to localized copy via t() at render time —
// keeping them as keys rather than baked strings means the same array
// works whether the user is on en or hi.
const STAGE_ROWS: Array<{
  gateStage: 'parsing' | 'designing' | 'translating' | 'deploying';
  labelKey: string;
  hintKey: string;
}> = [
  { gateStage: 'parsing',     labelKey: 'agents.preview.step1Label', hintKey: 'agents.preview.step1Hint' },
  { gateStage: 'designing',   labelKey: 'agents.preview.step2Label', hintKey: 'agents.preview.step2Hint' },
  { gateStage: 'translating', labelKey: 'agents.preview.step3Label', hintKey: 'agents.preview.step3Hint' },
  { gateStage: 'deploying',   labelKey: 'agents.preview.step4Label', hintKey: 'agents.preview.step4Hint' },
];

const STAGE_INDEX: Record<'parsing' | 'designing' | 'translating' | 'deploying' | 'ready', number> = {
  parsing: 0,
  designing: 1,
  translating: 2,
  deploying: 3,
  ready: 4,
};

type RowState = 'done' | 'active' | 'pending';

/**
 * Map the backend's current creationStage to per-row state.
 *
 *   parsing   → row0 active, rows1-3 pending
 *   designing → row0 done, row1 active, rows2-3 pending
 *   translating → rows0-1 done, row2 active, row3 pending
 *   deploying → rows0-2 done, row3 active
 *   ready     → all done
 */
function rowStatesForStage(
  stage: 'parsing' | 'designing' | 'translating' | 'deploying' | 'ready',
): RowState[] {
  const currentIdx = STAGE_INDEX[stage];
  return STAGE_ROWS.map((_, idx) => {
    if (idx < currentIdx) return 'done';
    if (idx === currentIdx) return 'active';
    return 'pending';
  });
}

export default function AgentPreviewScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { id, next } = useLocalSearchParams<{ id: string; next?: string }>();
  const setUser = useAuthStore((s) => s.setUser);

  // The ?next param picks the post-ready destination. Anything that's
  // 'home' OR 'campaign' triggers the auto-continue checklist branch;
  // they just route to different places when ready. No param → the
  // direct-entry summary layout.
  const autoContinueToCampaign = next === 'campaign';
  const autoContinueToHome = next === 'home';
  const autoContinue = autoContinueToCampaign || autoContinueToHome;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Track whether we've already flipped onboardingDone (defensive backstop;
  // the flag is now primarily set in profile-setup) and whether we've
  // already kicked off the auto-continue redirect.
  const onboardingMarked = useRef(false);
  const autoContinueScheduled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await api.get<{ agent: Agent }>(`/agents/${id}`);
        if (cancelled) return;
        setAgent(res.agent);

        const status = res.agent.status || 'ready';

        if (status === 'ready') {
          if (!onboardingMarked.current) {
            onboardingMarked.current = true;
            setUser({ onboardingDone: true });
          }
          // Auto-continue path: brief pause on success state then route
          // away. Destination depends on the entry mode — see the comment
          // block at the top of the file.
          if (autoContinue && !autoContinueScheduled.current) {
            autoContinueScheduled.current = true;
            setTimeout(() => {
              if (cancelled) return;
              if (autoContinueToHome) {
                router.replace('/(tabs)');
              } else if (autoContinueToCampaign) {
                router.replace('/campaigns/new');
              }
            }, READY_HOLD_MS);
          }
          return; // stop polling
        }
        if (status === 'failed') {
          return;
        }

        polls += 1;
        if (polls >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || t('agents.preview.loadFailed'));
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [id, setUser, autoContinue, autoContinueToHome, autoContinueToCampaign, router]);

  // Compute the current stage for the checklist. Treat null/undefined as
  // 'parsing' so the checklist shows progress from the very first poll,
  // even before the worker has written creationStage yet.
  const currentStage = useMemo<'parsing' | 'designing' | 'translating' | 'deploying' | 'ready'>(() => {
    if (!agent) return 'parsing';
    if ((agent.status || 'ready') === 'ready') return 'ready';
    return (agent.creationStage && agent.creationStage !== 'ready'
      ? agent.creationStage
      : 'parsing') as 'parsing' | 'designing' | 'translating' | 'deploying';
  }, [agent]);

  const rowStates = useMemo(() => rowStatesForStage(currentStage), [currentStage]);

  // ─────────────── Hard error ───────────────
  if (error) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorTitle}>{t('agents.preview.errorTitle')}</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.primaryButtonText}>{t('agents.preview.goHome')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─────────────── Failed worker ───────────────
  if (agent && agent.status === 'failed') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.failedTitleEn}>{t('agents.preview.failedTitle')}</Text>
        <Text style={styles.errorMessage}>
          {agent.error || t('agents.preview.failedFallback')}
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.primaryButtonText}>{t('agents.preview.backHome')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─────────────── Auto-continue branch (came from /agents/new or Create campaign) ───────────────
  // While creating OR briefly on ready, render the checklist. Once auto-
  // continue fires we've already scheduled router.replace, so we just
  // keep rendering the checklist (with all rows checked) until the
  // navigation completes. The ready-state subtitle adapts to the
  // destination so the user knows where they're about to land.
  if (autoContinue) {
    const readySubtitle = autoContinueToCampaign
      ? t('agents.preview.readyToCampaign')
      : t('agents.preview.readyToHome');
    return (
      <View style={styles.container}>
        <View style={styles.stageContainer}>
          <View style={styles.stageHeader}>
            {currentStage !== 'ready' ? (
              <View style={styles.stageMagicIcon}>
                <TatvaIcon name="ai-magic" size="xl" tone="brand" />
              </View>
            ) : null}
            <Text style={styles.stageEyebrow}>{t('agents.preview.eyebrow')}</Text>
            <Text style={styles.stageTitle}>
              {currentStage === 'ready'
                ? t('agents.preview.ready')
                : t('agents.preview.readying')}
            </Text>
            <Text style={styles.stageSubtitle}>
              {currentStage === 'ready'
                ? readySubtitle
                : t('agents.preview.firstTimeNote')}
            </Text>
          </View>

          <View style={styles.stageList}>
            {STAGE_ROWS.map((row, idx) => (
              <StageItem
                key={row.gateStage}
                state={rowStates[idx]}
                label={t(row.labelKey)}
                hint={t(row.hintKey)}
                isLast={idx === STAGE_ROWS.length - 1}
              />
            ))}
          </View>

          {timedOut ? (
            <View style={styles.timedOutBlock}>
              <Text style={styles.timedOutText}>
                {t('agents.preview.timedOut')}
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, { marginTop: 12 }]}
                onPress={() => router.replace('/(tabs)')}
              >
                <Text style={styles.primaryButtonText}>{t('agents.preview.continueHome')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // ─────────────── Direct entry (tapped agent card) ───────────────
  // Three branches:
  //   1. agent === null  → first fetch hasn't resolved yet. Render a
  //      clean loading state (spinner). Avoids the prior bug where
  //      tapping an already-ready agent flashed the 4-step "creating"
  //      list for ~2s while the GET completed.
  //   2. agent.status === 'creating' → genuine creation in progress;
  //      render the connected stage progress.
  //   3. ready → falls through to the user-facing summary below.

  if (!agent) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <TatvaIcon name="loader" size="2xl" color={COLORS.primary} spin />
        <Text style={styles.loadingLabel}>{t('agents.preview.loading')}</Text>
      </View>
    );
  }

  if ((agent.status || 'ready') === 'creating') {
    return (
      <View style={styles.container}>
        <View style={styles.stageContainer}>
          <View style={styles.stageHeader}>
            <View style={styles.stageMagicIcon}>
              <TatvaIcon name="ai-magic" size="xl" tone="brand" />
            </View>
            <Text style={styles.stageEyebrow}>{t('agents.preview.eyebrow')}</Text>
            <Text style={styles.stageTitle}>{t('agents.preview.readying')}</Text>
            <Text style={styles.stageSubtitle}>
              {t('agents.preview.firstTimeNote')}
            </Text>
          </View>

          <View style={styles.stageList}>
            {STAGE_ROWS.map((row, idx) => (
              <StageItem
                key={row.gateStage}
                state={rowStates[idx]}
                label={t(row.labelKey)}
                hint={t(row.hintKey)}
                isLast={idx === STAGE_ROWS.length - 1}
              />
            ))}
          </View>

          {timedOut ? (
            <View style={styles.timedOutBlock}>
              <Text style={styles.timedOutText}>
                {t('agents.preview.timedOut')}
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, { marginTop: 12 }]}
                onPress={() => router.replace('/(tabs)')}
              >
                <Text style={styles.primaryButtonText}>{t('agents.preview.continueHome')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // ─────────────── Ready (direct entry) — user-facing summary + tonality picker ───────────────
  // What we KEEP visible to the user:
  //   • Agent name + language chip
  //   • "What it does" — the only summary card the user actually needs
  //   • Tonality picker (Polite / Casual / Professional) — so they can
  //     tune the assistant's voice without re-authoring from scratch
  //   • Voice picker (placeholder, "Coming soon") — Avi will drop in
  //     audio sample files later; for now we show the disabled chip so
  //     the surface area is locked in
  //
  // What we HIDE (was previously visible, now considered internal):
  //   • "How it talks" — derived from prompt, not actionable
  //   • "Possible outcomes" — implementation detail of the call script
  //   • "For better calls, add" — reads like a backend tip, not a user
  //     decision
  // These remain in the API response so future back-office tooling can
  // surface them without another schema change.
  const s = agent.summaryNL || {};

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.readyScroll}
        contentContainerStyle={styles.readyScrollContent}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t('agents.preview.readyEyebrow')}</Text>
          <Text style={styles.title}>{agent.name}</Text>
          <View style={styles.metaRow}>
            {agent.language ? (
              <Text style={styles.metaChip}>{s.language || agent.language}</Text>
            ) : null}
          </View>
        </View>

        {s.whatItDoes ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('agents.preview.summaryWhatItDoes')}</Text>
            <Text style={styles.summaryBody}>{s.whatItDoes}</Text>
          </View>
        ) : null}

        <TonalityPicker
          agentId={agent.id}
          currentTone={agent.tone}
          agentLanguage={agent.language}
          onLocalToneChange={(next) =>
            setAgent((prev) => (prev ? { ...prev, tone: next } : prev))
          }
        />

        <VoicePickerPlaceholder />
      </ScrollView>

      <View style={styles.ctaStack}>
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={() => router.push('/campaigns/new')}
        >
          <Text style={styles.primaryCtaEn}>{t('agents.preview.ctaCreateCampaign')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={() => router.push(`/agents/${agent.id}/test-call`)}
        >
          <Text style={styles.secondaryCtaText}>
            {t('agents.preview.ctaTestCall')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tertiaryCta}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.tertiaryCtaText}>{t('agents.preview.backHome')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Single row of the stage checklist. Three visual states:
 *   - done    → filled ink circle with check, label dark
 *   - active  → filled ink circle with dot, label dark, hint visible
 *   - pending → outlined circle, label muted
 */
// ─────────────────────────────────────────────────────────────────────────
// Tonality picker — Polite / Casual / Professional.
// Optimistically updates the local agent.tone immediately on tap, then
// fires PUT /agents/:id in the background. On failure, reverts to the
// previous tone and surfaces a quiet inline error string.
//
// We re-send the user's existing businessDescription on every PUT so the
// backend can re-author the Samvaad agent with the new tone. Reading
// businessDesc from the auth store (set during profile-setup) means the
// UI doesn't have to fetch it again from /user/profile.
// ─────────────────────────────────────────────────────────────────────────

const TONE_OPTIONS: Array<{ value: 'polite' | 'casual' | 'professional'; labelKey: string }> = [
  { value: 'polite',       labelKey: 'agents.preview.tone.polite' },
  { value: 'casual',       labelKey: 'agents.preview.tone.casual' },
  { value: 'professional', labelKey: 'agents.preview.tone.professional' },
];

function TonalityPicker({
  agentId,
  currentTone,
  agentLanguage,
  onLocalToneChange,
}: {
  agentId: string;
  currentTone: string;
  agentLanguage: string;
  onLocalToneChange: (tone: string) => void;
}) {
  const { t } = useTranslation();
  const businessDesc = useAuthStore((s) => s.user?.businessDesc);
  const [saving, setSaving] = useState<string | null>(null); // tone being saved
  const [error, setError] = useState<string | null>(null);

  const handlePick = async (next: string) => {
    if (next === currentTone || saving) return;
    if (!businessDesc || businessDesc.trim().length < 10) {
      // Without a description we can't re-author — surface a soft notice
      // instead of crashing the request.
      setError(t('agents.preview.tone.needDesc'));
      return;
    }
    const previous = currentTone;
    onLocalToneChange(next);
    setSaving(next);
    setError(null);
    try {
      await api.put(`/agents/${agentId}`, {
        businessDescription: businessDesc,
        language: agentLanguage,
        tone: next,
      });
    } catch (err: any) {
      // Roll back optimistic change.
      onLocalToneChange(previous);
      setError(err?.message || t('agents.preview.tone.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{t('agents.preview.tone.label')}</Text>
      <View style={styles.toneRow}>
        {TONE_OPTIONS.map((opt) => {
          const active = opt.value === currentTone;
          const isThisSaving = saving === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => handlePick(opt.value)}
              activeOpacity={0.85}
              disabled={!!saving}
              style={[styles.tonePill, active && styles.tonePillActive]}
            >
              <Text style={[styles.tonePillText, active && styles.tonePillTextActive]}>
                {t(opt.labelKey)}
                {isThisSaving ? ' …' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? <Text style={styles.toneError}>{error}</Text> : null}
      <Text style={styles.toneHint}>{t('agents.preview.tone.hint')}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Voice picker — placeholder.
// Audio sample files will be dropped in by Avi later. The disabled state
// + "Coming soon" pill locks in the surface so the screen doesn't reflow
// when the real picker lands.
// ─────────────────────────────────────────────────────────────────────────
function VoicePickerPlaceholder() {
  const { t } = useTranslation();
  return (
    <View style={[styles.summaryCard, { opacity: 0.6 }]}>
      <View style={styles.voiceHeader}>
        <Text style={styles.summaryLabel}>{t('agents.preview.voice.label')}</Text>
        <View style={styles.comingSoonPill}>
          <Text style={styles.comingSoonText}>{t('agents.preview.voice.comingSoon')}</Text>
        </View>
      </View>
      <Text style={styles.summaryBody}>{t('agents.preview.voice.hint')}</Text>
    </View>
  );
}

function StageItem({
  state,
  label,
  hint,
  isLast,
}: {
  state: RowState;
  label: string;
  hint: string;
  /** Last row in the list — drops the trailing connector line. */
  isLast?: boolean;
}) {
  // Connector colour: filled (ink) when this row is done — meaning the
  // gap between this row and the next is also "complete". Otherwise a
  // muted hairline so the line still reads as a pathway, just not yet
  // walked.
  const connectorIsDone = state === 'done';

  return (
    <View style={styles.stageRow}>
      {/* Left rail: dot + connector line below it. The connector lives
          inside the same column so the line and the dots line up
          perfectly without flexbox alignment math. */}
      <View style={styles.stageRail}>
        <View
          style={[
            styles.stageDot,
            state === 'done' && styles.stageDotDone,
            state === 'active' && styles.stageDotActive,
            state === 'pending' && styles.stageDotPending,
          ]}
        >
          {state === 'done' ? (
            <CheckIcon size={11} color={COLORS.textOnInk} weight="bold" />
          ) : state === 'active' ? (
            <TatvaIcon
              name="loader"
              size="xs"
              color={COLORS.cream}
              strokeWidth={2.4}
              spin
            />
          ) : null}
        </View>
        {!isLast ? (
          <View
            style={[
              styles.stageConnector,
              connectorIsDone && styles.stageConnectorDone,
            ]}
          />
        ) : null}
      </View>

      <View style={styles.stageRowCopy}>
        <Text
          style={[
            styles.stageRowLabel,
            state === 'pending' && styles.stageRowLabelPending,
          ]}
        >
          {label}
        </Text>
        {state === 'active' ? (
          <Text style={styles.stageRowHint}>{hint}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  // Subtle "Loading…" label beneath the spinner during the first fetch.
  loadingLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 14,
    fontWeight: '500',
  },

  // ─── Single-screen stage checklist ───
  stageContainer: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 32,
  },
  stageHeader: {
    marginBottom: 28,
  },
  stageMagicIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  stageEyebrow: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  stageTitle: {
    fontSize: 22,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 6,
  },
  stageSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 13 * 1.55,
  },

  stageList: {
    // No more inter-row gap — the vertical connector inside each row's
    // rail acts as the spacing between dots.
    gap: 0,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  // Left rail: contains the dot AND the line that connects it to the
  // next row's dot. Width matches the dot for perfect alignment.
  stageRail: {
    width: 18,
    alignItems: 'center',
  },
  // Vertical line between this row's dot and the next. Filled (ink) when
  // the upstream row is done; muted hairline otherwise.
  stageConnector: {
    width: 2,
    flex: 1,
    minHeight: 22,
    backgroundColor: COLORS.border,
    marginTop: 2,
    marginBottom: 2,
  },
  stageConnectorDone: {
    backgroundColor: COLORS.ink,
  },
  stageDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stageDotDone: {
    backgroundColor: COLORS.ink,
  },
  stageDotActive: {
    backgroundColor: COLORS.ink,
  },
  stageDotPending: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stageRowCopy: {
    flex: 1,
    gap: 2,
    // Bottom padding gives the connector room so adjacent rows aren't
    // visually crammed when a row has only a label (no active hint).
    paddingBottom: 18,
  },
  stageRowLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  stageRowLabelPending: {
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  stageRowHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 12 * 1.45,
  },

  timedOutBlock: {
    marginTop: 32,
    alignItems: 'center',
  },
  timedOutText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 13 * 1.55,
  },

  // ─── Ready state (direct entry) ───
  readyScroll: { flex: 1 },
  readyScrollContent: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 16,
  },

  header: { marginBottom: 16 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: COLORS.text,
    marginTop: 2,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  metaChip: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.ink,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  metaChipMuted: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    backgroundColor: COLORS.statusMuteBg,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },

  summaryCard: {
    backgroundColor: COLORS.statusMuteBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  summaryBody: {
    fontSize: 12,
    color: COLORS.text,
    lineHeight: 12 * 1.45,
  },

  // ─── Tonality picker ────────────────────────────────────────
  toneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  tonePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  tonePillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tonePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  tonePillTextActive: {
    color: COLORS.textOnInk,
  },
  toneError: {
    fontSize: 11,
    color: COLORS.danger,
    marginTop: 6,
  },
  toneHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },

  // ─── Voice placeholder ──────────────────────────────────────
  voiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  comingSoonPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.statusExtensionBg,
  },
  comingSoonText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: COLORS.warning,
    textTransform: 'uppercase',
  },

  ctaStack: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
  },

  primaryCta: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCtaHi: {
    color: COLORS.textOnInk,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  primaryCtaEn: {
    color: COLORS.textOnInk,
    fontSize: 11,
    fontWeight: '400',
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 3,
  },

  secondaryCta: {
    marginTop: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCtaText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },

  tertiaryCta: {
    marginTop: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  tertiaryCtaText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '400',
  },

  // ─── Error / failed ───
  errorTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 14 * 1.45,
  },
  failedTitleHi: {
    fontSize: 22,
    fontWeight: '500',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  failedTitleEn: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },

  primaryButton: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: COLORS.textOnInk,
    fontSize: 13,
    fontWeight: '500',
  },
});
