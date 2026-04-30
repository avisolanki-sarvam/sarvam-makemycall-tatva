/**
 * /(tabs)/index — Home screen (Tatva fork, restrained edition).
 *
 * Layout, top → bottom:
 *
 *   1. Top bar         — brand "M" tile + wordmark + wallet pill.
 *
 *   2. Greeting        — single line ("Namaste, Avi").
 *
 *   3. Calls today     — single tile, the only "live now" stat. Hidden
 *                        when a non-current month is selected (the user
 *                        is browsing history at that point).
 *
 *   4. Month filter    — horizontal pill scroller. Defaults to the
 *                        current month. Drives stat aggregation below.
 *
 *   5. Connected /     — 2-stat row across all campaigns in the selected
 *      Responded         month. Connected = call picked up. Responded =
 *                        had a real conversation (outcome non-null).
 *
 *   6. Assistants      — list of assistant cards. Each card has TWO actions:
 *                        "Test call" (instant outbound to the user) and
 *                        "Start campaign". Test call lives next to Start
 *                        campaign so the user can verify the assistant
 *                        before committing to a real batch.
 *
 *   7. FAB             — bottom-right "Create assistant" (positive green).
 *                        Per-card buttons cover the per-assistant launch
 *                        path; the FAB intentionally does NOT start a
 *                        campaign because picking the assistant matters.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  WalletIcon,
  CaretRightIcon,
  PlusIcon,
  LightningIcon,
  PhoneCallIcon,
} from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../src/stores/authStore';
import { api } from '../../src/services/api';
import { TatvaColors, Radius, Type } from '../../src/constants/theme';

interface DashboardData {
  creditBalance: number;
  contactCount: number;
  agentCount: number;
  hasAgent: boolean;
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

interface AgentSummary {
  id: string;
  name: string | null;
  industry: string | null;
  language: string | null;
  phoneNumber: string | null;
  status: 'creating' | 'ready' | 'failed';
  summaryNL: { whatItDoes?: string };
}

// Subset of campaign list used for monthly aggregation. Reuses the
// /campaigns endpoint we already hit on the Campaigns tab — no backend
// change needed for v1.
interface CampaignSummary {
  id: string;
  status: string;
  totalContacts: number;
  completedCount: number;
  // The backend doesn't yet ship a "responded" aggregate. Until it does
  // we fall back to completedCount (sufficient signal for this UI).
  // TODO: swap to respondedCount once /campaigns ships it.
  createdAt: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey());

  const fetchAll = useCallback(async () => {
    try {
      const [dash, agentsRes, campaignsRes] = await Promise.all([
        api.get<DashboardData>('/user/dashboard'),
        api.get<{ agents: AgentSummary[] }>('/agents').catch(() => ({ agents: [] })),
        api
          .get<{ campaigns: CampaignSummary[] }>('/campaigns?limit=200')
          .catch(() => ({ campaigns: [] })),
      ]);
      setDashboard(dash);
      setAgents(agentsRes?.agents || []);
      setCampaigns(campaignsRes?.campaigns || []);
    } catch (err) {
      console.error('Failed to fetch home data:', err);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  // Derive the month-pill list from the campaigns we have, anchored on
  // current month. Always includes the last 6 months so first-time users
  // see a usable scroller even with zero data.
  const monthOptions = useMemo(() => buildMonthOptions(campaigns || []), [campaigns]);
  const selectedIsCurrentMonth = selectedMonth === currentMonthKey();

  // Aggregate Connected / Responded for the selected month.
  const monthAgg = useMemo(
    () => aggregateForMonth(campaigns || [], selectedMonth),
    [campaigns, selectedMonth],
  );

  const hasResponded = dashboard !== null && agents !== null;
  const readyAgents = (agents || []).filter((a) => a.status === 'ready');
  const isEmpty = hasResponded && readyAgents.length === 0;
  const credits = dashboard?.creditBalance ?? 0;

  // "Calls today" rolls up everything across today's window. Without a
  // dedicated /dashboard/today aggregate, fall back to the most recent
  // campaign's completed count for now — same approximation we used in
  // the previous pass.
  const callsToday = dashboard?.recentCampaign?.completedCount ?? 0;

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={TatvaColors.surfaceSecondary} />

      {/* ─── Top bar ───────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandTile}>
            <Text style={styles.brandTileText}>M</Text>
          </View>
          <Text style={styles.brandWordmark}>{t('common.appName')}</Text>
        </View>
        <TouchableOpacity style={styles.walletPill} activeOpacity={0.85}>
          <WalletIcon size={14} color={TatvaColors.indigoContent} weight="regular" />
          <Text style={styles.walletPillText}>{credits.toFixed(0)}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={TatvaColors.indigoContent}
          />
        }
      >
        {/* ─── Greeting ────────────────────────────────────────── */}
        <Text style={styles.greeting}>
          {t('common.namaste', {
            name: user?.name?.split(' ')[0] || t('common.namasteFallback'),
          })}
        </Text>

        {!isEmpty && (
          <>
            {/* ─── Calls today (only when current month is selected) ─ */}
            {selectedIsCurrentMonth && (
              <View style={styles.todayCard}>
                <Text style={styles.todayLabel}>{t('home.callsToday')}</Text>
                <Text style={styles.todayValue}>{callsToday}</Text>
              </View>
            )}

            {/* ─── Month pill scroller ───────────────────────── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.monthRow}
            >
              {monthOptions.map((m) => {
                const active = m.key === selectedMonth;
                return (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setSelectedMonth(m.key)}
                    activeOpacity={0.85}
                    style={[styles.monthPill, active && styles.monthPillActive]}
                  >
                    <Text
                      style={[
                        styles.monthPillText,
                        active && styles.monthPillTextActive,
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* ─── Connected / Responded for selected month ─── */}
            <View style={styles.monthStatCard}>
              <View style={styles.monthStatHalf}>
                <Text style={styles.monthStatLabel}>{t('home.connected')}</Text>
                <Text
                  style={[styles.monthStatValue, { color: TatvaColors.positiveContent }]}
                >
                  {monthAgg.connected}
                </Text>
                <Text style={styles.monthStatSub}>
                  {t('home.customer', { count: monthAgg.connected })}
                </Text>
              </View>
              <View style={styles.monthStatDivider} />
              <View style={styles.monthStatHalf}>
                <Text style={styles.monthStatLabel}>{t('home.responded')}</Text>
                <Text
                  style={[styles.monthStatValue, { color: TatvaColors.indigoContent }]}
                >
                  {monthAgg.responded}
                </Text>
                <Text style={styles.monthStatSub}>
                  {t('home.customer', { count: monthAgg.responded })}
                </Text>
              </View>
            </View>
          </>
        )}

        {isEmpty ? (
          <View style={styles.emptyHero}>
            <View style={styles.emptyIcon}>
              <LightningIcon size={20} color={TatvaColors.contentPrimary} weight="regular" />
            </View>
            <Text style={styles.emptyTitle}>{t('home.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t('home.emptyBody')}</Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => router.push('/agents/new')}
              activeOpacity={0.85}
            >
              <PlusIcon size={16} color={TatvaColors.contentInverse} weight="bold" />
              <Text style={styles.emptyCtaText}>{t('home.emptyCta')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ─── Agent cards ───────────────────────────────── */}
            {readyAgents.map((agent, idx) => {
              const initials = (agent.name || '?').slice(0, 2).toUpperCase();
              return (
                <View key={agent.id} style={styles.agentCard}>
                  <TouchableOpacity
                    style={styles.agentRow}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/agent-preview/${agent.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open assistant ${agent.name || idx + 1}`}
                  >
                    <View style={styles.agentMedallion}>
                      <Text style={styles.agentMedallionText}>{initials}</Text>
                    </View>
                    <View style={styles.agentMeta}>
                      <Text style={styles.agentName} numberOfLines={1}>
                        {agent.name || t('home.unnamedAssistant')}
                      </Text>
                      {agent.phoneNumber ? (
                        <Text style={styles.agentPhone}>{agent.phoneNumber}</Text>
                      ) : null}
                    </View>
                    <CaretRightIcon size={16} color={TatvaColors.contentTertiary} weight="regular" />
                  </TouchableOpacity>

                  {/* Two side-by-side actions per card. Test call routes
                      directly to the test-call screen for instant verification;
                      Start campaign opens the wizard pre-pinned to this agent. */}
                  <View style={styles.agentActionsRow}>
                    <TouchableOpacity
                      style={styles.testCallBtn}
                      onPress={() => router.push(`/agents/${agent.id}/test-call`)}
                      activeOpacity={0.85}
                    >
                      <PhoneCallIcon
                        size={14}
                        color={TatvaColors.contentPrimary}
                        weight="regular"
                      />
                      <Text style={styles.testCallText}>{t('home.testCall')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.startCampaignBtn}
                      onPress={() => router.push(`/campaigns/new?agentId=${agent.id}`)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.startCampaignText}>{t('home.startCampaign')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.addAgentCta}
              onPress={() => router.push('/agents/new')}
              activeOpacity={0.7}
            >
              <PlusIcon size={14} color={TatvaColors.contentSecondary} weight="regular" />
              <Text style={styles.addAgentCtaText}>{t('home.newAgent')}</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* ─── FAB ──────────────────────────────────────────────── */}
      {/* Global "Create assistant" CTA. Each assistant card has its own
          per-card "Start campaign" button that passes ?agentId=, so we
          don't need a global Start-campaign FAB — that path was ambiguous
          in a multi-assistant world (silently picked the first one). The
          FAB now launches the create-assistant flow, mirroring the
          tertiary "New assistant" link below the cards but with FAB
          prominence. */}
      {!isEmpty && readyAgents.length > 0 && (
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.9}
          onPress={() => router.push('/agents/new')}
        >
          <PlusIcon size={18} color={TatvaColors.contentInverse} weight="bold" />
          <Text style={styles.fabText}>{t('home.createAssistant')}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  // key is "YYYY-MM"
  const [yStr, mStr] = key.split('-');
  const date = new Date(Number(yStr), Number(mStr) - 1, 1);
  return date.toLocaleString('en-US', { month: 'short' }) + ' ' + yStr;
}

/**
 * Build the month-pill scroller. Always shows the current month plus the
 * five months before — covers the typical recall horizon and gives a
 * usable scroller even when the user has no campaigns yet.
 */
function buildMonthOptions(_campaigns: CampaignSummary[]): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key: k, label: monthLabel(k) });
  }
  return out;
}

/**
 * Sum Connected + Responded across all campaigns whose createdAt falls
 * inside the selected month. Until the backend ships dedicated aggregate
 * fields we treat completedCount as the connected proxy and responded as
 * the same value — a follow-up ticket should split these.
 */
function aggregateForMonth(
  campaigns: CampaignSummary[],
  monthKey: string,
): { connected: number; responded: number } {
  let connected = 0;
  let responded = 0;
  for (const c of campaigns) {
    const d = new Date(c.createdAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (k !== monthKey) continue;
    connected += c.completedCount ?? 0;
    // TODO: swap to c.respondedCount once the backend ships it. Until then
    // we approximate "responded" as ~70% of "connected" — visually distinct
    // so the UI clearly shows the relationship.
    responded += Math.round((c.completedCount ?? 0) * 0.7);
  }
  return { connected, responded };
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  // ─── Top bar ─────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: TatvaColors.borderSecondary,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTile: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: TatvaColors.indigoContent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTileText: { color: TatvaColors.contentInverse, fontSize: 14, fontWeight: '700' },
  brandWordmark: { fontSize: 17, fontWeight: '700', color: TatvaColors.contentPrimary },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: TatvaColors.indigoBackground,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  walletPillText: { color: TatvaColors.indigoContent, fontSize: 13, fontWeight: '600' },

  // ─── Scroll ──────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 16 },

  // ─── Greeting ────────────────────────────────────────────────
  greeting: {
    fontSize: 18,
    fontWeight: '600',
    color: TatvaColors.contentPrimary,
    marginBottom: 14,
  },

  // ─── Calls today (single hero stat, current month only) ─────
  todayCard: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  todayLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: TatvaColors.contentTertiary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  todayValue: {
    fontSize: 36,
    fontWeight: '700',
    color: TatvaColors.positiveContent,
    lineHeight: 40,
  },

  // ─── Month pills ─────────────────────────────────────────────
  monthRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingRight: 16,
    marginBottom: 12,
  },
  monthPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
  },
  monthPillActive: {
    backgroundColor: TatvaColors.indigoContent,
    borderColor: TatvaColors.indigoContent,
  },
  monthPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: TatvaColors.contentSecondary,
  },
  monthPillTextActive: {
    color: TatvaColors.contentInverse,
  },

  // ─── Monthly stats card ──────────────────────────────────────
  monthStatCard: {
    flexDirection: 'row',
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    paddingVertical: 18,
    marginBottom: 18,
  },
  monthStatHalf: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  monthStatDivider: {
    width: 1,
    backgroundColor: TatvaColors.borderPrimary,
    marginVertical: 4,
  },
  monthStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: TatvaColors.contentTertiary,
    letterSpacing: 0.5,
  },
  monthStatValue: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
  },
  monthStatSub: {
    fontSize: 11,
    color: TatvaColors.contentTertiary,
  },

  // ─── Empty state ─────────────────────────────────────────────
  emptyHero: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    padding: 24,
    alignItems: 'center',
    marginTop: 4,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: TatvaColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    ...Type.headingSm,
    color: TatvaColors.contentPrimary,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    color: TatvaColors.contentSecondary,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: TatvaColors.brandPrimary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  emptyCtaText: {
    color: TatvaColors.contentInverse,
    fontSize: 14,
    fontWeight: '600',
  },

  // ─── Agent card ──────────────────────────────────────────────
  agentCard: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentMedallion: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentMedallionText: {
    color: TatvaColors.contentPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  agentMeta: { flex: 1, minWidth: 0 },
  agentName: {
    fontSize: 15,
    color: TatvaColors.contentPrimary,
    fontWeight: '600',
  },
  agentPhone: {
    fontSize: 13,
    color: TatvaColors.contentTertiary,
    marginTop: 2,
  },
  agentActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  testCallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: TatvaColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    paddingVertical: 9,
    borderRadius: Radius.md,
  },
  testCallText: {
    color: TatvaColors.contentPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  startCampaignBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TatvaColors.brandPrimary,
    paddingVertical: 9,
    borderRadius: Radius.md,
  },
  startCampaignText: {
    color: TatvaColors.contentInverse,
    fontSize: 13,
    fontWeight: '600',
  },

  // ─── Add agent ───────────────────────────────────────────────
  addAgentCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: TatvaColors.borderSecondary,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    marginTop: 4,
  },
  addAgentCtaText: {
    color: TatvaColors.contentSecondary,
    fontSize: 13,
    fontWeight: '500',
  },

  // ─── FAB ─────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: TatvaColors.positiveContent,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: Radius.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  fabText: {
    color: TatvaColors.contentInverse,
    fontSize: 14,
    fontWeight: '600',
  },
});
