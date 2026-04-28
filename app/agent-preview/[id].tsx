/**
 * /agent-preview/[id]
 *
 * Post-onboarding "moment of wow" screen. The user just described their
 * business; this is where they see what their AI agent will actually do.
 *
 * Reads `summaryNL` from GET /agents/:id (synthesised at create time, so this
 * is a cheap single read — no LLM round-trip here).
 */

import { useEffect, useState } from 'react';
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
}

export default function AgentPreviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ agent: Agent }>(`/agents/${id}`);
        if (!cancelled) setAgent(res.agent);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load your agent.');
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

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

  if (!agent) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={COLORS.ink} />
        <Text style={styles.loadingText}>Tying the bow on your assistant...</Text>
      </View>
    );
  }

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
});
