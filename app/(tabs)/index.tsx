/**
 * /(tabs)/index — Home dashboard, sectioned (Indus + Avi mockup).
 *
 * Layout, top → bottom (dark surface throughout):
 *
 *   1. Top bar         — small BrandMark + "sarvam" wordmark + a compact
 *                        wallet pill that stays as a quick top-up entry.
 *
 *   2. Greeting        — eyebrow + display "What should we call today?".
 *
 *   3. Credits hero    — full-width brand-tinted tile. Balance numeral
 *                        + "Tap to add funds". Routes to /credits.
 *
 *   4. My Assistants   — section header ("My Assistants  view all >") +
 *                        "+ Create new" button at the right. Below: a
 *                        2-up row of the most recent assistant tiles.
 *                        If only one ready agent exists, the second slot
 *                        shows a dashed "+ Create new" placeholder so the
 *                        row doesn't collapse.
 *
 *   5. My Calls        — recent multi-contact call runs, shown in the same
 *                        peek + view-all pattern as assistants.
 *
 *   6. Business        — short business description with edit chevron
 *      Details          → /settings/edit-profile.
 *
 * Why this composition: the original home dumped every assistant + every
 * stat onto one screen. With the dashboard layout, each section is a
 * predictable "peek + view-all" pair — closer to Indus / Wallet / Stripe
 * dashboards. The user reaches actions in ≤2 taps from any state.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
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
  PlusIcon,
  CaretRightIcon,
  PhoneCallIcon,
  PaperPlaneTiltIcon,
  MegaphoneIcon,
} from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../src/stores/authStore';
import { api } from '../../src/services/api';
import { TatvaColors, Radius, Spacing, Shadow, Weight, StatusToTatva, CampaignStatus } from '../../src/constants/theme';
import { AppText } from '../../src/components/AppText';
import { BrandMark } from '../../src/components/BrandMark';
import { TatvaIcon } from '../../src/components/TatvaIcon';

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

interface CampaignSummary {
  id: string;
  name?: string | null;
  status: string;
  totalContacts: number;
  completedCount: number;
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

  const fetchAll = useCallback(async () => {
    try {
      const [dash, agentsRes, campaignsRes] = await Promise.all([
        api.get<DashboardData>('/user/dashboard'),
        api.get<{ agents: AgentSummary[] }>('/agents').catch(() => ({ agents: [] })),
        api
          .get<{ campaigns: CampaignSummary[] }>('/campaigns?limit=20')
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

  // Show only ready agents in the peek row — failed/creating clutter the
  // surface and the user can't act on them anyway. The full /agents list
  // shows all states.
  const readyAgents = useMemo(
    () => (agents || []).filter((a) => a.status === 'ready'),
    [agents],
  );
  const recentAgents = readyAgents.slice(0, 2);
  const recentCampaigns = (campaigns || []).slice(0, 2);

  const credits = dashboard?.creditBalance ?? 0;
  const userFirstName = user?.name?.split(' ')[0] || t('common.namasteFallback');

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={TatvaColors.surfacePrimary} />

      {/* ─── Top bar ───────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <BrandMark size={28} variant="gradient" />
          {/* Wordmark says the product name; the Saaras motif on its left
              is the Sarvam signal. Same logic as the splash. */}
          <AppText variant="heading-xs" style={{ fontWeight: Weight.bold }}>
            MakeMyCall
          </AppText>
        </View>
        <TouchableOpacity
          style={styles.walletPill}
          activeOpacity={0.85}
          onPress={() => router.push('/credits')}
        >
          <WalletIcon size={14} color={TatvaColors.brandContent} weight="regular" />
          <AppText
            variant="body-sm"
            style={{ color: TatvaColors.brandContent, fontWeight: Weight.semibold }}
          >
            {credits.toLocaleString('en-IN')}
          </AppText>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={TatvaColors.brandPrimary}
          />
        }
      >
        {/* ─── Greeting ─────────────────────────────────────────── */}
        <AppText variant="body-md" tone="tertiary" style={styles.greetingEyebrow}>
          Namaste, {userFirstName}
        </AppText>
        {/* Headline trimmed from "What should we call today?" → punchier
            "Who shall we call?", and dropped from display-md (34px) to
            display-sm (28px) so the credits hero stays above the fold on
            shorter phones. */}
        <AppText variant="display-sm" style={styles.greetingTitle}>
          Who shall we call?
        </AppText>

        {/* ─── Credits hero ────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.creditsHero}
          activeOpacity={0.85}
          onPress={() => router.push('/credits')}
        >
          <View style={styles.creditsHeroRow}>
            <View>
              <AppText
                variant="label-sm"
                style={{
                  color: TatvaColors.brandContent,
                  opacity: 0.85,
                  textTransform: 'uppercase',
                  marginBottom: Spacing['2'],
                }}
              >
                Credits
              </AppText>
              <AppText
                variant="numeral-lg"
                style={{ color: TatvaColors.contentPrimary }}
              >
                {credits.toLocaleString('en-IN')}
              </AppText>
              <AppText
                variant="body-sm"
                tone="tertiary"
                style={{ marginTop: Spacing['2'] }}
              >
                Tap to add funds
              </AppText>
            </View>
            <View style={styles.creditsCta}>
              <PlusIcon size={18} color={TatvaColors.contentPrimary} weight="bold" />
            </View>
          </View>
        </TouchableOpacity>

        {/* ─── My Assistants ───────────────────────────────────── */}
        <SectionHeader
          title="My Assistants"
          onViewAll={() => router.push('/agents')}
          onCreate={() => router.push('/agents/new')}
          createLabel="Create new"
        />
        <View style={styles.tileRow}>
          {recentAgents.map((agent) => (
            <AgentTile
              key={agent.id}
              agent={agent}
              onOpen={() => router.push(`/agent-preview/${agent.id}`)}
              onStartCalls={() =>
                router.push(`/campaigns/new?agentId=${agent.id}`)
              }
            />
          ))}
          {/* Pad the row with a placeholder so it stays 2-wide. */}
          {recentAgents.length < 2 ? (
            <CreatePlaceholderTile
              label="Create new assistant"
              onPress={() => router.push('/agents/new')}
            />
          ) : null}
        </View>

        {/* ─── My Calls ────────────────────────────────────────── */}
        <SectionHeader
          title="My Calls"
          onViewAll={() => router.push('/(tabs)/history')}
          onCreate={() =>
            router.push(
              recentAgents[0]
                ? `/campaigns/new?agentId=${recentAgents[0].id}`
                : '/campaigns/new',
            )
          }
          createLabel="Make My Call"
        />
        <View style={styles.tileRow}>
          {recentCampaigns.map((c) => (
            <CampaignTile
              key={c.id}
              campaign={c}
              onPress={() => router.push(`/campaigns/${c.id}`)}
            />
          ))}
          {recentCampaigns.length < 2 ? (
            <CreatePlaceholderTile
              label="Make My Call"
              onPress={() =>
                router.push(
                  recentAgents[0]
                    ? `/campaigns/new?agentId=${recentAgents[0].id}`
                    : '/campaigns/new',
                )
              }
            />
          ) : null}
        </View>

        {/* Business Details intentionally lives in Settings → Edit Profile,
            not on home. The home stays a pure "what can I do today" surface. */}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Section header ───────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  onViewAll?: () => void;
  /** Defaults to "View all". Use "Edit" for the business-details section. */
  viewLabel?: string;
  /** When provided, renders a "+ <createLabel>" pill on the right. */
  onCreate?: () => void;
  createLabel?: string;
}

function SectionHeader({
  title,
  onViewAll,
  viewLabel = 'View all',
  onCreate,
  createLabel,
}: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <AppText variant="heading-sm">{title}</AppText>
        {onViewAll ? (
          <TouchableOpacity
            onPress={onViewAll}
            hitSlop={8}
            style={styles.viewAllBtn}
          >
            <AppText
              variant="body-sm"
              tone="indigo"
              style={{ fontWeight: Weight.semibold }}
            >
              {viewLabel}
            </AppText>
            <CaretRightIcon
              size={14}
              color={TatvaColors.indigoContent}
              weight="bold"
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {onCreate && createLabel ? (
        <TouchableOpacity
          onPress={onCreate}
          activeOpacity={0.85}
          style={styles.createBtn}
        >
          <PlusIcon size={14} color={TatvaColors.contentPrimary} weight="bold" />
          <AppText
            variant="body-sm"
            style={{ fontWeight: Weight.semibold }}
          >
            {createLabel}
          </AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Agent tile ───────────────────────────────────────────────────────────

interface AgentTileProps {
  agent: AgentSummary;
  onOpen: () => void;
  onStartCalls: () => void;
}

function AgentTile({ agent, onOpen, onStartCalls }: AgentTileProps) {
  return (
    <TouchableOpacity
      style={styles.peekTile}
      activeOpacity={0.85}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open assistant ${agent.name || ''}`}
    >
      <View style={styles.tileMedallion}>
        <TatvaIcon name="audio-book" size="lg" tone="brand" />
      </View>
      <AppText variant="heading-xs" numberOfLines={1} style={styles.tileTitle}>
        {agent.name || 'Unnamed'}
      </AppText>
      {agent.phoneNumber ? (
        <AppText variant="body-xs" tone="tertiary" numberOfLines={1}>
          {agent.phoneNumber}
        </AppText>
      ) : null}
      <TouchableOpacity
        style={styles.tileActionBtn}
        onPress={onStartCalls}
        activeOpacity={0.85}
      >
        <PhoneCallIcon size={12} color={TatvaColors.brandContentInverse} weight="bold" />
        <AppText
          variant="body-xs"
          style={{
            color: TatvaColors.brandContentInverse,
            fontWeight: Weight.semibold,
          }}
        >
          Make My Call
        </AppText>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Campaign tile ────────────────────────────────────────────────────────

interface CampaignTileProps {
  campaign: CampaignSummary;
  onPress: () => void;
}

function CampaignTile({ campaign, onPress }: CampaignTileProps) {
  const status = StatusToTatva[(campaign.status as CampaignStatus) || 'scheduled'];
  return (
    <TouchableOpacity
      style={styles.peekTile}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={[styles.tileMedallion, { backgroundColor: TatvaColors.indigoBackground }]}>
        <MegaphoneIcon
          size={18}
          color={TatvaColors.indigoContent}
          weight="regular"
        />
      </View>
      <AppText variant="heading-xs" numberOfLines={1} style={styles.tileTitle}>
        {campaign.name || 'Call list'}
      </AppText>
      <AppText variant="body-xs" tone="tertiary">
        {campaign.completedCount ?? 0} / {campaign.totalContacts ?? 0} calls
      </AppText>
      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
        <AppText
          variant="label-sm"
          style={{ color: status.fg, fontSize: 10 }}
        >
          {status.label.toUpperCase()}
        </AppText>
      </View>
    </TouchableOpacity>
  );
}

// ─── Create-new placeholder ──────────────────────────────────────────────

function CreatePlaceholderTile({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.peekTile, styles.peekTileDashed]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={[styles.tileMedallion, styles.tileMedallionGhost]}>
        <PlusIcon size={20} color={TatvaColors.contentTertiary} weight="bold" />
      </View>
      <AppText variant="body-sm" tone="secondary" style={{ fontWeight: Weight.medium }}>
        {label}
      </AppText>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  // ─── Top bar ─────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['8'],
    paddingTop: Spacing['6'],
    paddingBottom: Spacing['6'],
    backgroundColor: TatvaColors.surfacePrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TatvaColors.borderPrimary,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing['4'] },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
    backgroundColor: TatvaColors.brandSurface,
    paddingHorizontal: Spacing['6'],
    paddingVertical: Spacing['3'],
    borderRadius: Radius.full,
  },

  // ─── Scroll ──────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing['8'], paddingBottom: Spacing['8'] },

  // ─── Greeting ────────────────────────────────────────────────
  greetingEyebrow: { marginBottom: Spacing['2'] },
  greetingTitle: { marginBottom: Spacing['10'] },

  // ─── Credits hero ────────────────────────────────────────────
  creditsHero: {
    backgroundColor: TatvaColors.brandSurface,
    borderRadius: Radius.lg,
    padding: Spacing['10'],
    marginBottom: Spacing['12'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.brandPrimary,
  },
  creditsHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  creditsCta: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Section header ──────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing['5'],
    gap: Spacing['4'],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
    flex: 1,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['1'],
    paddingVertical: Spacing['2'],
    paddingHorizontal: Spacing['1'],
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
    paddingHorizontal: Spacing['5'],
    paddingVertical: Spacing['3'],
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.borderSecondary,
  },

  // ─── Tile row ───────────────────────────────────────────────
  tileRow: {
    flexDirection: 'row',
    gap: Spacing['5'],
    marginBottom: Spacing['12'],
  },
  peekTile: {
    flex: 1,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.borderSecondary,
    padding: Spacing['8'],
    minHeight: 160,
    gap: Spacing['2'],
    ...Shadow.l1,
  },
  peekTileDashed: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  tileMedallion: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.brandSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing['3'],
  },
  tileMedallionGhost: {
    backgroundColor: TatvaColors.surfaceTertiary,
  },
  tileTitle: {},
  tileActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing['2'],
    backgroundColor: TatvaColors.brandPrimary,
    paddingVertical: Spacing['3'],
    paddingHorizontal: Spacing['4'],
    borderRadius: Radius.full,
    marginTop: 'auto',
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing['3'],
    paddingVertical: Spacing['1'],
    borderRadius: Radius.full,
    marginTop: 'auto',
  },

});
