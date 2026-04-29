import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { COLORS } from '../../src/constants/api';
import { api } from '../../src/services/api';

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  totalContacts: number;
  completedCount: number;
  creditsCharged: number;
  createdAt: string;
}

export default function CampaignsScreen() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const res = await api.get<{ campaigns: CampaignRow[] }>('/campaigns?limit=50');
      setCampaigns(res?.campaigns || []);
    } catch {
      setCampaigns([]);
    }
  }, []);

  // Refresh every time the tab is focused so newly-launched campaigns show up.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        if (mounted) {
          setLoading(true);
          await fetchList();
          if (mounted) setLoading(false);
        }
      })();
      return () => {
        mounted = false;
      };
    }, [fetchList])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchList();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (campaigns.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.emptyTitle}>No campaigns yet</Text>
        <Text style={styles.emptyText}>
          Launch your first call campaign from the home screen.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push('/campaigns/new')}
        >
          <Text style={styles.primaryBtnText}>New campaign</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={campaigns}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.row}
            onPress={() => router.push(`/campaigns/${item.id}`)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.completedCount}/{item.totalContacts} connected · {item.creditsCharged} credits
              </Text>
            </View>
            <StatusChip status={item.status} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    scheduled:  { bg: COLORS.statusMuteBg,      fg: COLORS.statusMuteFg,      label: 'Scheduled' },
    scheduling: { bg: COLORS.statusExtensionBg, fg: COLORS.statusExtensionFg, label: 'Scheduling' },
    active:     { bg: COLORS.statusExtensionBg, fg: COLORS.statusExtensionFg, label: 'Calling' },
    completed:  { bg: COLORS.statusCommittedBg, fg: COLORS.statusCommittedFg, label: 'Done' },
    failed:     { bg: COLORS.statusDeclinedBg,  fg: COLORS.statusDeclinedFg,  label: 'Failed' },
    cancelled:  { bg: COLORS.statusMuteBg,      fg: COLORS.statusMuteFg,      label: 'Cancelled' },
  };
  const m = map[status] || map.scheduled;
  return (
    <View style={[styles.chip, { backgroundColor: m.bg }]}>
      <Text style={[styles.chipText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  listContent: { padding: 12 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    gap: 10,
  },
  rowName: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  rowMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 3 },
  // Status chip — sentence case label, no uppercase. Colour pair flows through
  // bg/fg props from the StatusChip mapper.
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 11, fontWeight: '500' },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: COLORS.text, marginBottom: 6 },
  emptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 18 },
  primaryBtn: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  primaryBtnText: { color: COLORS.textOnInk, fontWeight: '500', fontSize: 13 },
});
