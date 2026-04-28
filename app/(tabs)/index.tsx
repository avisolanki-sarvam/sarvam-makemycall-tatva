import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';

interface DashboardData {
  creditBalance: number;
  contactCount: number;
  hasAgent: boolean;
  agentName: string | null;
  businessDesc: string | null;
  recentCampaign: {
    id: string;
    status: string;
    totalContacts: number;
    completedCount: number;
    createdAt: string;
  } | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.get<DashboardData>('/user/dashboard');
      setDashboard(data);
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboard();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <Text style={styles.greeting}>
        Hello, {user?.name || 'there'}
      </Text>

      {/* Credit Balance Card */}
      <View style={styles.creditCard}>
        <View>
          <Text style={styles.creditLabel}>Credit Balance</Text>
          <Text style={styles.creditAmount}>₹{dashboard?.creditBalance?.toFixed(2) || '0.00'}</Text>
        </View>
        <TouchableOpacity style={styles.topUpBtn}>
          <Text style={styles.topUpText}>+ Top Up</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{dashboard?.contactCount || 0}</Text>
          <Text style={styles.statLabel}>Contacts</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{dashboard?.hasAgent ? '1' : '0'}</Text>
          <Text style={styles.statLabel}>AI Agent</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{dashboard?.recentCampaign ? '1' : '0'}</Text>
          <Text style={styles.statLabel}>Campaigns</Text>
        </View>
      </View>

      {/* Agent Card */}
      {dashboard?.hasAgent && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your AI Agent</Text>
          <Text style={styles.agentName}>{dashboard.agentName}</Text>
          {dashboard.businessDesc ? (
            <Text style={styles.agentDesc}>{dashboard.businessDesc}</Text>
          ) : null}
          <Text style={styles.cardSubtext}>Ready to make calls</Text>
        </View>
      )}

      {/* Recent Campaign */}
      {dashboard?.recentCampaign ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Campaign</Text>
          <View style={styles.batchRow}>
            <View>
              <Text style={styles.batchStatus}>{dashboard.recentCampaign.status.toUpperCase()}</Text>
              <Text style={styles.cardSubtext}>
                {dashboard.recentCampaign.completedCount}/{dashboard.recentCampaign.totalContacts} calls completed
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No campaigns yet</Text>
          <Text style={styles.cardSubtext}>
            Add contacts and launch your first AI calling campaign
          </Text>
        </View>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/contacts' )}
        >
          <Text style={styles.actionIcon}>👥</Text>
          <Text style={styles.actionLabel}>Add Contacts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/campaigns/new')}
        >
          <Text style={styles.actionIcon}>📞</Text>
          <Text style={styles.actionLabel}>New Campaign</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/history' )}
        >
          <Text style={styles.actionIcon}>📊</Text>
          <Text style={styles.actionLabel}>View Results</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/settings' )}
        >
          <Text style={styles.actionIcon}>⚙️</Text>
          <Text style={styles.actionLabel}>Settings</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 32 },
  greeting: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 16 },

  creditCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  creditLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  creditAmount: { fontSize: 28, fontWeight: '800', color: COLORS.textOnInk, marginTop: 2 },
  topUpBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  topUpText: { color: COLORS.textOnInk, fontWeight: '700', fontSize: 14 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statNum: { fontSize: 22, fontWeight: '800', color: COLORS.primary },
  statLabel: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600', marginTop: 2 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  cardSubtext: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  agentName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  agentDesc: { fontSize: 14, color: COLORS.textSecondary, marginTop: 6, lineHeight: 20 },
  batchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  batchStatus: { fontSize: 14, fontWeight: '700', color: COLORS.primary },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginTop: 8, marginBottom: 12 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: {
    flexBasis: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  actionIcon: { fontSize: 28 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text },
});
