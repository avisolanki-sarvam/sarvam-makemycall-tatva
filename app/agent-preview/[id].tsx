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
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';

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
const STAGE_ROWS: Array<{
  gateStage: 'parsing' | 'designing' | 'translating' | 'deploying';
  label: string;
  hint: string;
}> = [
  {
    gateStage: 'parsing',
    label: 'Business details parsed',
    hint: 'Aapki baat samjh raha hoon',
  },
  {
    gateStage: 'designing',
    label: 'Assistant designed',
    hint: 'Tone aur script taiyaar',
  },
  {
    gateStage: 'translating',
    label: 'Bhaasha configured',
    hint: 'Multi-language support added',
  },
  {
    gateStage: 'deploying',
    label: 'Calling line assigned',
    hint: 'Phone number reserved',
  },
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
        if (!cancelled) setError(e?.message || 'Could not load your assistant.');
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
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.primaryButtonText}>Go to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─────────────── Failed worker ───────────────
  if (agent && agent.status === 'failed') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.failedTitleHi}>Setup poora nahi ho paaya</Text>
        <Text style={styles.failedTitleEn}>Setup didn't finish</Text>
        <Text style={styles.errorMessage}>
          {agent.error
            || "Ek baar aur try karein — agar phir bhi nahi hua toh hum madad karenge."}
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.primaryButtonText}>Back to home</Text>
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
      ? 'Setting up your campaign next…'
      : 'Aap home par wapas ja rahe hain…';
    return (
      <View style={styles.container}>
        <View style={styles.stageContainer}>
          <View style={styles.stageHeader}>
            <Text style={styles.stageEyebrow}>Aapka assistant</Text>
            <Text style={styles.stageTitle}>
              {currentStage === 'ready'
                ? 'Taiyaar hai!'
                : 'Taiyaar ho raha hai…'}
            </Text>
            <Text style={styles.stageSubtitle}>
              {currentStage === 'ready'
                ? readySubtitle
                : 'Pehli baar thoda time lagta hai. Setting up your AI assistant…'}
            </Text>
          </View>

          <View style={styles.stageList}>
            {STAGE_ROWS.map((row, idx) => (
              <StageItem
                key={row.gateStage}
                state={rowStates[idx]}
                label={row.label}
                hint={row.hint}
              />
            ))}
          </View>

          {timedOut ? (
            <View style={styles.timedOutBlock}>
              <Text style={styles.timedOutText}>
                Thoda aur waqt lag raha hai. Aap thodi der mein wapas aa
                sakte hain.
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, { marginTop: 12 }]}
                onPress={() => router.replace('/(tabs)')}
              >
                <Text style={styles.primaryButtonText}>Continue to home</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // ─────────────── Direct entry (tapped agent card) ───────────────
  // Mirror the auto-continue checklist while creating, but on ready render
  // the full agent summary + CTA stack so the user can review and act.

  if (!agent || (agent.status || 'ready') === 'creating') {
    return (
      <View style={styles.container}>
        <View style={styles.stageContainer}>
          <View style={styles.stageHeader}>
            <Text style={styles.stageEyebrow}>Aapka assistant</Text>
            <Text style={styles.stageTitle}>Taiyaar ho raha hai…</Text>
            <Text style={styles.stageSubtitle}>
              Pehli baar thoda time lagta hai. Setting up your AI assistant…
            </Text>
          </View>

          <View style={styles.stageList}>
            {STAGE_ROWS.map((row, idx) => (
              <StageItem
                key={row.gateStage}
                state={rowStates[idx]}
                label={row.label}
                hint={row.hint}
              />
            ))}
          </View>

          {timedOut ? (
            <View style={styles.timedOutBlock}>
              <Text style={styles.timedOutText}>
                Thoda aur waqt lag raha hai. Aap thodi der mein wapas aa
                sakte hain.
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, { marginTop: 12 }]}
                onPress={() => router.replace('/(tabs)')}
              >
                <Text style={styles.primaryButtonText}>Continue to home</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // ─────────────── Ready (direct entry) — full summary + CTA stack ───────────────
  const s = agent.summaryNL || {};
  const outcomes = Array.isArray(s.possibleOutcomes) ? s.possibleOutcomes : [];
  const extras   = Array.isArray(s.suggestedExtraFields) ? s.suggestedExtraFields : [];

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.readyScroll}
        contentContainerStyle={styles.readyScrollContent}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Aapka assistant taiyaar hai</Text>
          <Text style={styles.title}>{agent.name}</Text>
          <View style={styles.metaRow}>
            {agent.language ? (
              <Text style={styles.metaChip}>{s.language || agent.language}</Text>
            ) : null}
            {agent.tone ? (
              <Text style={styles.metaChipMuted}>{agent.tone}</Text>
            ) : null}
          </View>
        </View>

        {s.whatItDoes ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>What it does</Text>
            <Text style={styles.summaryBody}>{s.whatItDoes}</Text>
          </View>
        ) : null}

        {s.howItTalks ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>How it talks</Text>
            <Text style={styles.summaryBody}>{s.howItTalks}</Text>
          </View>
        ) : null}

        {outcomes.length > 0 ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Possible outcomes</Text>
            <Text style={styles.summaryBody}>
              {outcomes.map((o) => o.label).join(' · ')}
            </Text>
          </View>
        ) : null}

        {extras.length > 0 ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>For better calls, add</Text>
            <Text style={styles.summaryBody}>
              {extras.map((x) => x.field).join(', ')}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.ctaStack}>
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={() => router.push('/campaigns/new')}
        >
          <Text style={styles.primaryCtaHi}>Naya campaign banayein</Text>
          <Text style={styles.primaryCtaEn}>Create a campaign</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={() => router.push(`/agents/${agent.id}/test-call`)}
        >
          <Text style={styles.secondaryCtaText}>
            Pehle ek test call try karein
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tertiaryCta}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.tertiaryCtaText}>Back to home</Text>
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
function StageItem({
  state,
  label,
  hint,
}: {
  state: RowState;
  label: string;
  hint: string;
}) {
  return (
    <View style={styles.stageRow}>
      <View
        style={[
          styles.stageDot,
          state === 'done' && styles.stageDotDone,
          state === 'active' && styles.stageDotActive,
          state === 'pending' && styles.stageDotPending,
        ]}
      >
        {state === 'done' ? (
          <Feather name="check" size={11} color={COLORS.textOnInk} />
        ) : state === 'active' ? (
          <View style={styles.stageInnerDot} />
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
    gap: 14,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
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
  // Centered inner pip on the active row — communicates "in progress"
  // distinct from the check on done rows.
  stageInnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cream,
  },
  stageRowCopy: {
    flex: 1,
    gap: 2,
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
