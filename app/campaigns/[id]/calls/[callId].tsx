import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { LegacyColorTokens } from '../../../../src/constants/theme';
import { api } from '../../../../src/services/api';
import { useAppTheme } from '../../../../src/theme/AppThemeProvider';

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

function useCallDetailThemeStyles() {
  const { legacyColors: COLORS } = useAppTheme();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  return { COLORS, styles };
}

export default function CallDetailScreen() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const id = Array.isArray(callId) ? callId[0] : callId;
  const router = useRouter();
  const { t } = useTranslation();
  const { COLORS, styles } = useCallDetailThemeStyles();

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
        <Text style={styles.errorTxt}>{t('campaigns.call.notFound')}</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.linkTxt}>← {t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← {t('common.back')}</Text>
      </TouchableOpacity>

      <Text style={styles.name}>{call.contactName || t('campaigns.call.unknown')}</Text>
      <Text style={styles.phone}>{call.contactPhone || ''}</Text>

      <View style={styles.metaRow}>
        <Meta label={t('campaigns.call.status')} value={(call.connectivityStatus || '').replace('_', ' ')} />
        {call.durationSec ? <Meta label={t('campaigns.call.duration')} value={t('campaigns.detail.secondsSuffix', { seconds: call.durationSec })} /> : null}
        <Meta label={t('campaigns.call.cost')} value={t('campaigns.call.credits', { count: call.cost })} />
      </View>

      {call.outcomeSummary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('campaigns.call.whatHappened')}</Text>
          <Text style={styles.summaryQuote}>"{call.outcomeSummary}"</Text>
          {call.outcome && (
            <Text style={styles.outcomeKey}>{t('campaigns.call.outcome', { outcome: call.outcome.replace('_', ' ') })}</Text>
          )}
        </View>
      )}

      {call.transcript && call.transcript.length > 0 && (
        <View style={styles.transcriptCard}>
          <Text style={styles.summaryLabel}>{t('campaigns.call.transcript')}</Text>
          {call.transcript.map((entry, i) => (
            <View key={i} style={styles.turn}>
              <Text style={styles.role}>{entry.role === 'agent' ? t('campaigns.call.speakerAi') : t('campaigns.call.speakerCustomer')}</Text>
              <Text style={styles.text}>{entry.text}</Text>
            </View>
          ))}
        </View>
      )}

      {!call.transcript && call.connectivityStatus !== 'connected' && (
        <View style={styles.transcriptCard}>
          <Text style={styles.dimText}>
            {t('campaigns.call.noTranscript')}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  const { styles } = useCallDetailThemeStyles();

  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (COLORS: LegacyColorTokens) => StyleSheet.create({
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
