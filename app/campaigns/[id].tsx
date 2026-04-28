import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS } from '../../src/constants/api';
import { api } from '../../src/services/api';

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  totalContacts: number;
  completedCount: number;
  creditsReserved: number;
  creditsCharged: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isTest: boolean;
  kpis: {
    total: number;
    pending: number;
    connected: number;
    noAnswer: number;
    busy: number;
    failed: number;
    declined: number;
  };
}

interface CallRow {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  connectivityStatus: string | null;
  completionStatus: string | null;
  durationSec: number | null;
  outcome: string | null;
  outcomeSummary: string | null;
  cost: number;
  calledAt: string | null;
}

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaignId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    if (!campaignId) return;
    const [c, cs] = await Promise.all([
      api.get<{ campaign: CampaignDetail }>(`/campaigns/${campaignId}`).catch(() => null),
      api.get<{ calls: CallRow[] }>(`/campaigns/${campaignId}/calls`).catch(() => ({ calls: [] })),
    ]);
    if (c?.campaign) setCampaign(c.campaign);
    if (cs?.calls) setCalls(cs.calls);
  }, [campaignId]);

  // Initial fetch + auto-poll while the campaign is in flight (spec §4.13).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  useEffect(() => {
    const isLive = campaign && (campaign.status === 'scheduling' || campaign.status === 'active');
    if (isLive) {
      if (!pollRef.current) {
        pollRef.current = setInterval(fetchAll, 3000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [campaign?.status, fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const cancelCampaign = async () => {
    if (!campaignId) return;
    Alert.alert('Cancel campaign?', 'Reserved credits will be refunded.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/campaigns/${campaignId}/cancel`);
            await fetchAll();
          } catch (e: any) {
            Alert.alert('Could not cancel', e?.message || 'Try again.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }
  if (!campaign) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorTxt}>Campaign not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.linkTxt}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const k = campaign.kpis;
  const cancellable = campaign.status === 'scheduled' || campaign.status === 'active';

  return (
    <View style={styles.container}>
      <FlatList
        data={calls}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backTxt}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{campaign.name}</Text>
            <Text style={styles.subtitle}>
              {campaign.status === 'completed'
                ? 'Done'
                : campaign.status === 'active'
                  ? 'Calling now…'
                  : campaign.status === 'scheduling'
                    ? 'Getting ready…'
                    : campaign.status === 'scheduled'
                      ? `Scheduled for ${campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString() : 'later'}`
                      : campaign.status === 'cancelled'
                        ? 'Cancelled'
                        : 'Failed'}
            </Text>

            <View style={styles.kpiRow}>
              <Kpi label="Connected" value={k.connected} bg={COLORS.statusCommittedBg} fg={COLORS.statusCommittedFg} />
              <Kpi label="No answer" value={k.noAnswer + k.busy} bg={COLORS.statusMuteBg} fg={COLORS.statusMuteFg} />
              <Kpi label="Failed" value={k.failed + k.declined} bg={COLORS.statusDeclinedBg} fg={COLORS.statusDeclinedFg} />
              <Kpi label="Pending" value={k.pending} bg={COLORS.statusExtensionBg} fg={COLORS.statusExtensionFg} />
            </View>

            <View style={styles.creditLine}>
              <Text style={styles.creditTxt}>
                {campaign.creditsCharged} of {campaign.creditsReserved} credits used
              </Text>
              {cancellable && (
                <TouchableOpacity onPress={cancelCampaign}>
                  <Text style={styles.cancelLink}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sectionLabel}>Calls</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>
              No calls yet. {campaign.status === 'active' ? 'They\'re happening now…' : 'Check back in a moment.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.callRow}
            onPress={() => router.push(`/campaigns/${campaignId}/calls/${item.id}`)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.contactName?.charAt(0) || '?').toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.callName}>{item.contactName || item.contactPhone || 'Unknown'}</Text>
              {item.outcomeSummary ? (
                <Text style={styles.callQuote} numberOfLines={2}>"{item.outcomeSummary}"</Text>
              ) : (
                <Text style={styles.callMeta}>{item.contactPhone}</Text>
              )}
              <View style={styles.callMetaRow}>
                <OutcomeChip connectivity={item.connectivityStatus} outcome={item.outcome} />
                {item.durationSec ? <Text style={styles.callDuration}>{item.durationSec}s</Text> : null}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function Kpi({ label, value, bg, fg }: { label: string; value: number; bg: string; fg: string }) {
  return (
    <View style={[styles.kpi, { backgroundColor: bg }]}>
      <Text style={[styles.kpiNum, { color: fg }]}>{value}</Text>
      <Text style={[styles.kpiLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

function OutcomeChip({ connectivity, outcome }: { connectivity: string | null; outcome: string | null }) {
  // outcome (committed / extension / declined / no_clarity) takes precedence
  // if set; else fall back to the connectivity bucket.
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    committed:  { bg: COLORS.statusCommittedBg, fg: COLORS.statusCommittedFg, label: 'Committed' },
    extension:  { bg: COLORS.statusExtensionBg, fg: COLORS.statusExtensionFg, label: 'Extension' },
    declined:   { bg: COLORS.statusDeclinedBg,  fg: COLORS.statusDeclinedFg,  label: 'Declined' },
    no_clarity: { bg: COLORS.statusMuteBg,      fg: COLORS.statusMuteFg,      label: 'Unclear' },
    connected:  { bg: COLORS.statusCommittedBg, fg: COLORS.statusCommittedFg, label: 'Connected' },
    no_answer:  { bg: COLORS.statusMuteBg,      fg: COLORS.statusMuteFg,      label: 'No answer' },
    busy:       { bg: COLORS.statusMuteBg,      fg: COLORS.statusMuteFg,      label: 'Busy' },
    failed:     { bg: COLORS.statusDeclinedBg,  fg: COLORS.statusDeclinedFg,  label: 'Failed' },
  };
  const key = outcome || connectivity || 'no_answer';
  const m = map[key] || map.no_answer;
  return (
    <View style={[styles.outcomeChip, { backgroundColor: m.bg }]}>
      <Text style={[styles.outcomeChipText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  listContent: { paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  header: { padding: 16, paddingTop: 56 },
  backBtn: { alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 8 },
  backTxt: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },

  kpiRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  kpi: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'flex-start',
  },
  kpiNum: { fontSize: 22, fontWeight: '800' },
  kpiLabel: { fontSize: 11, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  creditLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  creditTxt: { fontSize: 13, color: COLORS.textSecondary },
  cancelLink: { fontSize: 13, fontWeight: '700', color: COLORS.danger },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },

  emptyBlock: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },

  callRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  callName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  callQuote: { fontSize: 12.5, color: COLORS.textSecondary, marginTop: 2, fontStyle: 'italic' },
  callMeta: { fontSize: 12.5, color: COLORS.textMuted, marginTop: 2 },
  callMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  callDuration: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  outcomeChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  outcomeChipText: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },

  errorTxt: { fontSize: 14, color: COLORS.danger, marginBottom: 16 },
  linkTxt: { fontSize: 14, fontWeight: '600', color: COLORS.text, paddingVertical: 6 },
});
