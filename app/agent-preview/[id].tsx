/**
 * /agent-preview/[id]
 *
 * Post-onboarding "moment of wow" screen. The user just submitted their
 * business description; the backend returned 202 with a stub Agent row
 * (status:'creating') and queued the heavy LLM + Samvaad work to a BullMQ
 * worker. This screen polls GET /agents/:id every 2s and progressively
 * swaps its skeleton for the real summaryNL when status flips to 'ready'.
 *
 * Three render states:
 *   - 'creating' → staged loading copy ("Aapka assistant taiyaar kar raha hoon…")
 *   - 'ready'    → full summary + bilingual "Call your people" CTA
 *   - 'failed'   → error card + "Try again" CTA back to profile-setup
 *
 * Polling caps at 60s (30 polls × 2s). On timeout we surface a "still
 * working — we'll have it ready in a moment" CTA into /(tabs); the agent
 * will eventually flip on the backend and the dashboard will pick it up
 * on the next open (dashboard.js filters status:'ready').
 *
 * onboardingDone is set HERE (not in profile-setup) the first time we
 * observe status === 'ready'. Rationale: a user who kills the app while
 * status is still 'creating' should re-open to onboarding, not to /(tabs)
 * with a half-built agent.
 */

import { useEffect, useRef, useState } from 'react';
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
  // Async-creation lifecycle. While 'creating', the LLM/Samvaad work is still
  // running on the backend and the rest of the fields (name, summaryNL, etc.)
  // may be empty/placeholder. Preview screen polls GET /agents/:id until this
  // flips to 'ready' (or 'failed', in which case `error` holds the reason).
  status?: 'creating' | 'ready' | 'failed';
  // Fine-grained progress within the 'creating' lifecycle. Backend writes this
  // as the BullMQ worker advances stages so the preview screen can show the
  // user what's happening instead of a blank skeleton. Null/undefined → treat
  // as 'parsing' (the earliest stage). 'ready' may briefly appear alongside
  // status flipping to 'ready'.
  creationStage?: 'parsing' | 'designing' | 'translating' | 'deploying' | 'ready' | null;
  error?: string | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60s total

/** Three pulsing dots — primary at full / 50% / 22% opacity, 8px round, 6px gap. */
function StageDots() {
  return (
    <View style={styles.dotsRow}>
      <View style={[styles.dot, { opacity: 1 }]} />
      <View style={[styles.dot, { opacity: 0.5 }]} />
      <View style={[styles.dot, { opacity: 0.22 }]} />
    </View>
  );
}

/** Phone icon for the deploying-stage medallion. Uses Feather (already in
 *  @expo/vector-icons, no new dependency) so it renders crisp on every
 *  device — the unicode ☎ glyph rendered as an emoji on some Androids. */
function PhoneIcon() {
  return <Feather name="phone" size={20} color={COLORS.ink} />;
}

export default function AgentPreviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const setUser = useAuthStore((s) => s.setUser);

  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Track whether we've already flipped onboardingDone — avoids spamming the
  // store on every poll once status === 'ready'.
  const onboardingMarked = useRef(false);

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

        const status = res.agent.status || 'ready'; // backend defaults; treat undefined as ready

        if (status === 'ready') {
          // First time we observe ready: mark onboarding complete. The user
          // can now safely land on /(tabs) on subsequent app opens.
          if (!onboardingMarked.current) {
            onboardingMarked.current = true;
            setUser({ onboardingDone: true });
          }
          return; // stop polling
        }
        if (status === 'failed') {
          return; // stop polling, failed-state UI takes over
        }

        // Still 'creating' — schedule next poll if under cap.
        polls += 1;
        if (polls >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load your agent.');
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [id, setUser]);

  // ---------- Hard error (network / 404) ----------
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

  // ---------- First fetch hasn't returned yet ----------
  if (!agent) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <StageDots />
        <View style={styles.stageCopyBlock}>
          <Text style={styles.stageHi}>Aapka assistant taiyaar kar raha hoon…</Text>
          <Text style={styles.stageEn}>Setting things up…</Text>
        </View>
      </View>
    );
  }

  const status = agent.status || 'ready';

  // ---------- Failed: worker errored ----------
  if (status === 'failed') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.failedTitleHi}>Setup poora nahi ho paaya</Text>
        <Text style={styles.failedTitleEn}>Setup didn't finish</Text>
        <Text style={styles.errorMessage}>
          {agent.error
            || "Ek baar aur try karein — agar phir bhi nahi hua toh hum madad karenge."}
        </Text>
        <Text style={styles.failedSubtitleEn}>
          Try again — if it still doesn't work, we'll help.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/profile-setup')}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>

        {/* Escape hatch: even with a failed agent row, the importer screen
            handles the agent-failed state via its own banner — so we still
            offer the user a parallel-work path. */}
        {agent.id ? (
          <TouchableOpacity
            style={[styles.importCta, { marginTop: 12, alignSelf: 'stretch' }]}
            onPress={() => router.push(`/contacts/import?agentId=${agent.id}`)}
          >
            <Text style={styles.importCtaHi}>Contacts add karein</Text>
            <Text style={styles.importCtaEn}>Add contacts in the meantime</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // ---------- Creating: staged loading state ----------
  if (status === 'creating') {
    // Map backend creationStage → bilingual copy. Undefined / null / unknown
    // values fall back to 'parsing' (earliest stage) so the user sees friendly
    // copy from the very first poll, before the worker has written anything.
    const stage = agent.creationStage && agent.creationStage !== 'ready'
      ? agent.creationStage
      : 'parsing';

    const STAGE_COPY: Record<
      'parsing' | 'designing' | 'translating' | 'deploying',
      { hi: string; en: string }
    > = {
      parsing: {
        hi: 'Aapki baat samjh raha hoon…',
        en: 'Understanding your business…',
      },
      designing: {
        hi: 'Aapka assistant taiyaar kar raha hoon…',
        en: 'Designing your assistant…',
      },
      translating: {
        hi: 'Hindi, Tamil, Bengali — sab mein baat karna sikha raha hoon…',
        en: 'Teaching it to switch languages…',
      },
      deploying: {
        hi: 'Phone number assign kar raha hoon…',
        en: 'Reserving your phone number…',
      },
    };

    const copy = STAGE_COPY[stage as keyof typeof STAGE_COPY] || STAGE_COPY.parsing;

    // designing + translating reveal the agent name once the LLM has parsed it.
    const showNameReveal =
      !!agent.name && (stage === 'designing' || stage === 'translating');

    return (
      <View style={[styles.container, styles.creatingContainer]}>
        {/* Name reveal — designing / translating stages only, after the LLM has
            populated agent.name. Gives the user something of theirs to anchor
            on while the rest provisions. */}
        {showNameReveal ? (
          <View style={styles.namePreview}>
            <Text style={styles.namePreviewLabel}>Aapka assistant</Text>
            <Text style={styles.namePreviewName}>{agent.name}</Text>
          </View>
        ) : null}

        {/* Translating stage shows a row of language chips between name and dots */}
        {stage === 'translating' ? (
          <View style={styles.langChipRow}>
            <Text style={styles.langChip}>Hindi</Text>
            <Text style={styles.langChip}>Tamil</Text>
            <Text style={styles.langChip}>Bengali</Text>
            <Text style={styles.langChip}>+ 7</Text>
          </View>
        ) : null}

        {/* Deploying stage shows a phone-icon medallion above the dots */}
        {stage === 'deploying' ? (
          <View style={styles.deployIcon}>
            <PhoneIcon />
          </View>
        ) : null}

        <StageDots />

        <View style={styles.stageCopyBlock}>
          <Text style={styles.stageHi}>{copy.hi}</Text>
          <Text style={styles.stageEn}>{copy.en}</Text>
        </View>

        {/* Escape hatch: user can start importing contacts in parallel while
            the agent finishes provisioning. Always shown during creating —
            agent.id is the stub-row id, available from the very first poll. */}
        {agent.id ? (
          <TouchableOpacity
            style={[styles.importCta, styles.importCtaCreating]}
            onPress={() => router.push(`/contacts/import?agentId=${agent.id}`)}
          >
            <Text style={styles.importCtaHi}>Contacts add karein</Text>
            <Text style={styles.importCtaEn}>Add contacts in the meantime</Text>
          </TouchableOpacity>
        ) : null}

        {timedOut ? (
          <View style={styles.timedOutBlock}>
            <Text style={styles.timedOutText}>
              Thoda aur waqt lag raha hai. Aap thodi der mein wapas aa sakte hain.
            </Text>
            <Text style={styles.timedOutSubText}>
              Still working in the background — feel free to come back in a moment.
            </Text>
            <TouchableOpacity
              style={[styles.primaryCta, { marginTop: 16 }]}
              onPress={() => router.replace('/(tabs)')}
            >
              <Text style={styles.primaryCtaHi}>Continue to home</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }

  // ---------- Ready: the existing happy-path layout ----------
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
        {/* Primary post-author CTA: jump straight into importing the user's
            contacts so they can run real outbound calls. router.push (not
            replace) so back returns here. */}
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={() => router.push(`/contacts/import?agentId=${agent.id}`)}
        >
          <Text style={styles.primaryCtaHi}>Apne customers ko call karein</Text>
          <Text style={styles.primaryCtaEn}>Call your people</Text>
        </TouchableOpacity>

        {/* Persistent "Add contacts in the meantime" escape hatch. On the ready
            state the primary CTA already points to the importer, but we keep
            this here for visual + behavioural consistency with the loading and
            failed states (a user landing here from the home card sees the
            same option in the same place regardless of agent status). */}
        <TouchableOpacity
          style={styles.importCta}
          onPress={() => router.push(`/contacts/import?agentId=${agent.id}`)}
        >
          <Text style={styles.importCtaHi}>Contacts add karein</Text>
          <Text style={styles.importCtaEn}>Add contacts in the meantime</Text>
        </TouchableOpacity>

        {/* Demoted from primary — still useful for someone who wants to hear
            their assistant before sending it to real customers. */}
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
          <Text style={styles.tertiaryCtaText}>Looks good — continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },

  // ---- Loading / staged states ----
  creatingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },

  // Three pulsing dots — 8px round, 6px gap, primary ink at three opacities.
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    marginBottom: 14,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },

  // Stage copy block — Hindi big, English small/secondary, both centered.
  stageCopyBlock: {
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  stageHi: {
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 18 * 1.45,
    maxWidth: 226,
  },
  stageEn: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 13 * 1.45,
    maxWidth: 226,
  },

  // Name reveal — designing / translating stages only.
  namePreview: {
    alignItems: 'center',
    marginBottom: 22,
  },
  namePreviewLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  namePreviewName: {
    fontSize: 24,
    fontWeight: '500',
    color: COLORS.text,
    textAlign: 'center',
  },

  // Translating-stage chips row.
  langChipRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 22,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  langChip: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.ink,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },

  // Deploying-stage phone medallion.
  deployIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  phoneIconGlyph: {
    fontSize: 20,
    color: COLORS.ink,
    lineHeight: 22,
  },

  // Timed-out block — appears below the dots once polling caps out.
  timedOutBlock: {
    marginTop: 32,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  timedOutText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    textAlign: 'center',
  },
  timedOutSubText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },

  // ---- Ready state ----
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

  // ---- CTA stack — pinned to the bottom of the screen ----
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

  // Outlined "Add contacts in the meantime" CTA — visible on every state so
  // the user is never trapped staring at loading copy. Mirrors the bilingual
  // stack of the primary CTA (Hi 13/500, En 11/400 @ 0.7) but outlined so it
  // doesn't compete visually with the primary action.
  importCta: {
    marginTop: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  importCtaHi: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  importCtaEn: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '400',
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 3,
  },
  // On centered loading layouts (creatingContainer) we stretch the CTA to
  // a comfortable thumb-width and push it well below the staged copy so it
  // doesn't crowd the dots/copy block.
  importCtaCreating: {
    marginTop: 24,
    alignSelf: 'stretch',
    marginHorizontal: 12,
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

  // ---- Error / failed states ----
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
  failedSubtitleEn: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 20,
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
