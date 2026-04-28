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
import { COLORS } from '../../../../src/constants/api';
import { api } from '../../../../src/services/api';

interface CallDetail {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  connectivityStatus: string | null;
  completionStatus: string | null;
  durationSec: number | null;
  audioUrl: string | null;
  outcome: string | null;
  outcomeSummary: string | null;
  cost: number;
  transcript: { role: string; text: string }[] | null;
  calledAt: string | null;
}

export default function CallDetailScreen() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const id = Array.isArray(callId) ? callId[0] : callId;
  const router = useRouter();

  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ call: CallDetail }>(`/calls/${id}`);
        if (!cancelled) setCall(res.call);
      } catch {
        if (!cancelled) setCall(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }
  if (!call) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorTxt}>Call not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.linkTxt}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.name}>{call.contactName || 'Unknown'}</Text>
      <Text style={styles.phone}>{call.contactPhone || ''}</Text>

      <View style={styles.metaRow}>
        <Meta label="Status" value={(call.connectivityStatus || '').replace('_', ' ')} />
        {call.durationSec ? <Meta label="Duration" value={`${call.durationSec}s`} /> : null}
        <Meta label="Cost" value={`${call.cost} credit${call.cost === 1 ? '' : 's'}`} />
      </View>

      {call.outcomeSummary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>What happened</Text>
          <Text style={styles.summaryQuote}>"{call.outcomeSummary}"</Text>
          {call.outcome && (
            <Text style={styles.outcomeKey}>Outcome: {call.outcome.replace('_', ' ')}</Text>
          )}
        </View>
      )}

      {call.transcript && call.transcript.length > 0 && (
        <View style={styles.transcriptCard}>
          <Text style={styles.summaryLabel}>Transcript</Text>
          {call.transcript.map((t, i) => (
            <View key={i} style={styles.turn}>
              <Text style={styles.role}>{t.role === 'agent' ? 'AI' : 'Customer'}</Text>
              <Text style={styles.text}>{t.text}</Text>
            </View>
          ))}
        </View>
      )}

      {!call.transcript && call.connectivityStatus !== 'connected' && (
        <View style={styles.transcriptCard}>
          <Text style={styles.dimText}>
            No transcript — the call didn't connect.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingTop: 56, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },

  backBtn: { alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 8 },
  backTxt: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600' },

  name: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  phone: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },

  metaRow: { flexDirection: 'row', gap: 18, marginTop: 18 },
  meta: {},
  metaLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  metaValue: { fontSize: 14, color: COLORS.text, fontWeight: '600', marginTop: 3 },

  summaryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  summaryQuote: { fontSize: 15, color: COLORS.text, fontStyle: 'italic', lineHeight: 21 },
  outcomeKey: { fontSize: 12, color: COLORS.textMuted, marginTop: 8, fontWeight: '600' },

  transcriptCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  turn: { marginBottom: 12 },
  role: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  text: { fontSize: 14, color: COLORS.text, lineHeight: 20 },
  dimText: { fontSize: 13, color: COLORS.textMuted, fontStyle: 'italic' },

  errorTxt: { fontSize: 14, color: COLORS.danger, marginBottom: 16 },
  linkTxt: { fontSize: 14, fontWeight: '600', color: COLORS.text, paddingVertical: 6 },
});
