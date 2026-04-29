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
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/authStore';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';

interface DashboardData {
  creditBalance: number;
  contactCount: number;
  agentCount: number;
  hasAgent: boolean;
  // Backend surfaces the most-recent ready agent's id + assigned phone so
  // we can deep-link into /agents/:id/test-call without a second fetch.
  agentId: string | null;
  agentName: string | null;
  agentPhoneNumber: string | null;
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

  // Empty-state: user is logged in but hasn't created their first agent yet.
  // We deliberately suppress credit balance / stats / quick actions here —
  // they're all 0/0/0 and the noise distracts from the one thing the user
  // needs to do next. Settings remains reachable via the tab bar.
  //
  // Render only when we've HEARD from the dashboard endpoint and it confirmed
  // hasAgent === false. While dashboard is null we show the populated layout
  // with default zeros; the brief flash is preferable to a fake empty-state
  // that snaps to populated half a second later.
  if (dashboard !== null && !dashboard.hasAgent) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.greeting}>
            Hello, {user?.name || 'there'}
          </Text>
          <Text style={styles.greetingSubtitle}>
            Aapka AI phone assistant — abhi setup karein.
          </Text>
        </View>

        <View style={styles.emptyHero}>
          <Text style={styles.emptyEyebrow}>Aapka pehla assistant</Text>
          <Text style={styles.emptyTitle}>Apne business ke baare mein bataiye</Text>
          <Text style={styles.emptyBody}>
            1-2 lines mein batayein aap kya kaam karte hain. Hum aapka AI phone assistant ek minute mein taiyaar kar denge.
          </Text>
          <Text style={styles.emptyBodyEn}>
            Tell us what you do in 1-2 lines. We'll set up your AI phone assistant in under a minute.
          </Text>

          <TouchableOpacity
            style={styles.emptyCta}
            onPress={() => router.push('/profile-setup')}
          >
            <Text style={styles.emptyCtaHi}>Shuru karein</Text>
            <Text style={styles.emptyCtaEn}>Get started</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.emptyFootnote}>
          Settings, contacts aur campaigns niche tab bar mein hamesha available hain.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <View style={styles.headerBlock}>
        <Text style={styles.greeting}>
          Hello, {user?.name || 'there'}
        </Text>
        <Text style={styles.greetingSubtitle}>
          Your AI phone secretary, ready when you are.
        </Text>
      </View>

      {/* Credit balance card */}
      <View style={styles.creditCard}>
        <View>
          <Text style={styles.creditLabel}>Credit balance</Text>
          <Text style={styles.creditAmount}>₹{dashboard?.creditBalance?.toFixed(2) || '0.00'}</Text>
        </View>
        <TouchableOpacity style={styles.topUpBtn}>
          <Text style={styles.topUpText}>+ Top up</Text>
        </TouchableOpacity>
      </View>

      {/* Quick stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{dashboard?.contactCount || 0}</Text>
          <Text style={styles.statLabel}>Contacts</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{dashboard?.agentCount ?? (dashboard?.hasAgent ? 1 : 0)}</Text>
          <Text style={styles.statLabel}>{(dashboard?.agentCount ?? 0) === 1 ? 'AI agent' : 'AI agents'}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{dashboard?.recentCampaign ? '1' : '0'}</Text>
          <Text style={styles.statLabel}>Campaigns</Text>
        </View>
      </View>

      {/* Agent card — entire card is tappable and pushes to /agent-preview/:id
          when we have an agentId (the post-onboarding moment-of-wow / live
          status surface). The inner "Place a test call" TouchableOpacity
          handles its own onPress; nested touchables in RN don't bubble — the
          inner press wins — so tapping the test-call button does NOT also
          trigger the outer card navigation. */}
      {dashboard?.hasAgent && (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={dashboard.agentId ? 0.7 : 1}
          onPress={
            dashboard.agentId
              ? () => router.push(`/agent-preview/${dashboard.agentId}`)
              : undefined
          }
          accessibilityRole="button"
          accessibilityLabel="Open agent details"
        >
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardEyebrow}>Your AI agent</Text>
            {dashboard.agentId ? (
              <Feather
                name="chevron-right"
                size={16}
                color={COLORS.textMuted}
              />
            ) : null}
          </View>
          <Text style={styles.agentName}>{dashboard.agentName}</Text>
          {dashboard.businessDesc ? (
            <Text style={styles.agentDesc}>{dashboard.businessDesc}</Text>
          ) : null}
          {dashboard.agentPhoneNumber ? (
            <Text style={styles.cardSubtext}>
              Calling from {dashboard.agentPhoneNumber}
            </Text>
          ) : (
            <Text style={styles.cardSubtext}>Ready to make calls</Text>
          )}

          {/* Test-call CTA — only shown once we have an agentId AND the agent
              has been deployed to a phone number. The backend endpoint will
              409 with agent_no_phone otherwise, so suppressing the button
              when phoneNumber is null avoids a confusing dead-end tap. */}
          {dashboard.agentId && dashboard.agentPhoneNumber ? (
            <TouchableOpacity
              style={styles.agentCardBtn}
              onPress={() =>
                router.push(`/agents/${dashboard.agentId}/test-call`)
              }
            >
              <Text style={styles.agentCardBtnText}>Place a test call</Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      )}

      {/* Recent campaign */}
      {dashboard?.recentCampaign ? (
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>Recent campaign</Text>
          <View style={styles.batchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.batchStatus}>
                {humanizeStatus(dashboard.recentCampaign.status)}
              </Text>
              <Text style={styles.cardSubtext}>
                {dashboard.recentCampaign.completedCount}/{dashboard.recentCampaign.totalContacts} calls completed
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>No campaigns yet</Text>
          <Text style={styles.cardSubtext}>
            Add contacts and launch your first AI calling campaign.
          </Text>
        </View>
      )}

      {/* Quick actions.
          "Call your people" routes to the contact-import flow (save contacts to
          address book). "Naya campaign banayein" routes to the campaign composer
          at /campaigns/new — same destination as the bottom-tab Campaigns "+"
          flow, so the two paths agree. Without an agent yet, both bounce the
          user to /profile-setup so they author one first. */}
      <Text style={styles.sectionTitle}>Quick actions</Text>
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() =>
            dashboard?.agentId
              ? router.push(`/contacts/import?agentId=${dashboard.agentId}`)
              : router.push('/profile-setup')
          }
        >
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionLabel}>Call your people</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() =>
            dashboard?.agentId
              ? router.push('/campaigns/new')
              : router.push('/profile-setup')
          }
        >
          <Text style={styles.actionIcon}>📞</Text>
          <Text style={styles.actionLabel}>Naya campaign banayein</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/contacts' )}
        >
          <Text style={styles.actionIcon}>👥</Text>
          <Text style={styles.actionLabel}>Manage contacts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/history' )}
        >
          <Text style={styles.actionIcon}>📊</Text>
          <Text style={styles.actionLabel}>View results</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// Lowercase status → presentable sentence-case label. Lives next to the screen
// because nothing else uses it.
function humanizeStatus(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 32 },

  headerBlock: { marginBottom: 16, gap: 4 },
  greeting: { fontSize: 22, fontWeight: '500', color: COLORS.text },
  greetingSubtitle: { fontSize: 13, color: COLORS.textSecondary },

  // Credit card — kept ink-on-cream for emphasis. Top-up button uses the
  // cream background tint to read as a quiet pill against the dark surface.
  creditCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  creditLabel: { fontSize: 11, color: COLORS.textOnInk, fontWeight: '500', opacity: 0.7 },
  creditAmount: { fontSize: 22, fontWeight: '500', color: COLORS.textOnInk, marginTop: 2 },
  topUpBtn: {
    backgroundColor: COLORS.cream,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  topUpText: { color: COLORS.ink, fontWeight: '500', fontSize: 13 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
  },
  statNum: { fontSize: 22, fontWeight: '500', color: COLORS.text },
  statLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '500', marginTop: 2 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginBottom: 6,
  },
  // Agent-card header row — eyebrow on the left, subtle chevron-right on the
  // right hinting the card itself is tappable.
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardSubtext: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  agentName: { fontSize: 16, fontWeight: '500', color: COLORS.text },
  agentDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 6,
    lineHeight: 13 * 1.5,
  },
  batchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  batchStatus: { fontSize: 14, fontWeight: '500', color: COLORS.text },

  agentCardBtn: {
    marginTop: 12,
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  agentCardBtnText: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },

  sectionTitle: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 8,
    marginBottom: 10,
  },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    gap: 6,
  },
  actionIcon: { fontSize: 24 },
  actionLabel: { fontSize: 13, fontWeight: '500', color: COLORS.text, textAlign: 'center' },

  // Empty-state hero — shown when dashboard.hasAgent === false. Mirrors the
  // mockup's "card with eyebrow + title + body + filled-ink CTA" pattern,
  // sized larger so it carries the screen on its own.
  emptyHero: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    padding: 20,
    marginTop: 8,
    marginBottom: 16,
  },
  emptyEyebrow: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 20 * 1.3,
    marginBottom: 12,
  },
  emptyBody: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 14 * 1.55,
    marginBottom: 8,
  },
  emptyBodyEn: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 12 * 1.55,
    marginBottom: 18,
  },
  emptyCta: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  emptyCtaHi: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },
  emptyCtaEn: { color: COLORS.textOnInk, fontSize: 11, fontWeight: '400', opacity: 0.7, marginTop: 2 },

  emptyFootnote: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 12 * 1.5,
    paddingHorizontal: 16,
  },
});
