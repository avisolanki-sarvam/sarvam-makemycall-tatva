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
 *   - 'creating' → skeleton placeholders ("Designing your assistant…")
 *   - 'ready'    → full summary + "Looks good" CTA into /(tabs)
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
  ActivityIndicator,
} from 'react-native';
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
  error?: string | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60s total

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
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.buttonText}>Go to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- First fetch hasn't returned yet ----------
  if (!agent) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={COLORS.ink} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const status = agent.status || 'ready';

  // ---------- Failed: worker errored ----------
  if (status === 'failed') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorTitle}>We couldn't finish setting up</Text>
        <Text style={styles.errorMessage}>
          {agent.error || 'Something interrupted the setup. Please try again.'}
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/profile-setup')}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- Creating: skeleton state ----------
  if (status === 'creating') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Designing your assistant</Text>
          <View style={styles.skelTitle} />
          <View style={styles.metaRow}>
            <View style={styles.skelChip} />
            <View style={styles.skelChip} />
          </View>
        </View>

        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.section}>
            <View style={styles.skelLabel} />
            <View style={styles.skelLine} />
            <View style={[styles.skelLine, { width: '85%' }]} />
            <View style={[styles.skelLine, { width: '60%' }]} />
          </View>
        ))}

        <View style={styles.creatingFooter}>
          <ActivityIndicator size="small" color={COLORS.textSecondary} />
          <Text style={styles.creatingFooterText}>
            {timedOut
              ? "Still working in the background. You can come back in a moment."
              : "Reading your description and shaping your assistant…"}
          </Text>
        </View>

        {timedOut ? (
          <TouchableOpacity
            style={[styles.cta, { marginTop: 12 }]}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.ctaText}>Continue to home</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    );
  }

  // ---------- Ready: the existing happy-path layout ----------
  const s = agent.summaryNL || {};
  const outcomes = Array.isArray(s.possibleOutcomes) ? s.possibleOutcomes : [];
  const extras   = Array.isArray(s.suggestedExtraFields) ? s.suggestedExtraFields : [];
  const required = Array.isArray(s.requiredContactFields) ? s.requiredContactFields : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Aapka assistant taiyaar hai</Text>
        <Text style={styles.title}>{agent.name}</Text>
        <View style={styles.metaRow}>
          {agent.language ? <Text style={styles.metaChip}>{s.language || agent.language}</Text> : null}
          {agent.tone ? <Text style={styles.metaChipMuted}>{agent.tone}</Text> : null}
        </View>
      </View>

      {s.whatItDoes ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>What it does</Text>
          <Text style={styles.sectionBody}>{s.whatItDoes}</Text>
        </View>
      ) : null}

      {s.howItTalks ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>How it talks</Text>
          <Text style={styles.sectionBody}>{s.howItTalks}</Text>
        </View>
      ) : null}

      {outcomes.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Possible outcomes</Text>
          <View style={styles.outcomeList}>
            {outcomes.map((o) => (
              <View key={o.key} style={styles.outcomeRow}>
                <View style={styles.bullet} />
                <Text style={styles.outcomeLabel}>{o.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {extras.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>For better calls, add</Text>
          <View style={styles.extraList}>
            {extras.map((x) => (
              <View key={x.field} style={styles.extraCard}>
                <Text style={styles.extraField}>{x.field}</Text>
                {x.reason ? <Text style={styles.extraReason}>{x.reason}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {required.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Each contact needs</Text>
          <View style={styles.requiredRow}>
            {required.map((field) => (
              <Text key={field} style={styles.requiredChip}>{field}</Text>
            ))}
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.cta}
        onPress={() => router.replace('/(tabs)')}
      >
        <Text style={styles.ctaText}>Looks good — continue</Text>
      </TouchableOpacity>

      <Text style={styles.foot}>You can edit your assistant anytime in Settings.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 48 },

  loadingText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 16 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  errorMessage: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 20 },

  header: { marginBottom: 28 },
  eyebrow: {
    fontSize: 12, fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 6,
  },
  title: { fontSize: 30, fontWeight: '800', color: COLORS.text, lineHeight: 36 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  metaChip: {
    fontSize: 12, fontWeight: '700',
    color: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  metaChipMuted: {
    fontSize: 12, fontWeight: '600',
    color: COLORS.textSecondary,
    backgroundColor: COLORS.statusMuteBg,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },

  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1, borderColor: COLORS.borderSoft,
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionBody: { fontSize: 15, color: COLORS.text, lineHeight: 22 },

  outcomeList: { gap: 8 },
  outcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  outcomeLabel: { fontSize: 14, color: COLORS.text, flex: 1 },

  extraList: { gap: 10 },
  extraCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1, borderColor: COLORS.borderSoft,
  },
  extraField: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  extraReason: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },

  requiredRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  requiredChip: {
    fontSize: 12, fontWeight: '600',
    color: COLORS.text,
    backgroundColor: COLORS.background,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border,
  },

  cta: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 18,
  },
  ctaText: { color: COLORS.textOnInk, fontSize: 16, fontWeight: '700' },
  foot: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: 14 },

  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12, paddingHorizontal: 28, paddingVertical: 12,
  },
  buttonText: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '700' },

  // Skeleton placeholders for the 'creating' state. Static gray boxes —
  // a subtle pulse animation could come later, but flat boxes already
  // communicate "loading" clearly when paired with the spinner footer.
  skelTitle: {
    height: 30, width: '70%',
    backgroundColor: COLORS.borderSoft,
    borderRadius: 8,
    marginTop: 4,
  },
  skelChip: {
    height: 22, width: 70,
    backgroundColor: COLORS.borderSoft,
    borderRadius: 999,
  },
  skelLabel: {
    height: 12, width: 100,
    backgroundColor: COLORS.borderSoft,
    borderRadius: 4,
    marginBottom: 12,
  },
  skelLine: {
    height: 12, width: '100%',
    backgroundColor: COLORS.borderSoft,
    borderRadius: 4,
    marginBottom: 8,
  },
  creatingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  creatingFooterText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    flex: 1,
    textAlign: 'left',
  },
});
