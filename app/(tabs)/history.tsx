/**
 * /(tabs)/history — Campaigns screen (Tatva fork, restrained edition).
 *
 * Layout (CollectPay parity):
 *
 *   1. Header     — brand "M" tile + "Campaigns" + small refresh icon
 *                   button (top-right, monochrome, no coloured chip).
 *
 *   2. Stat bar   — 4 numbers across a single bordered card. The number
 *                   carries the colour (black / green / amber / indigo).
 *                   The label is always grey, always sentence-case caps.
 *
 *   3. Campaign   — list of campaign cards. Each card:
 *      cards         · neutral megaphone tile + name + date  ·  status pill
 *                    · 3 KPI lines (Sent / Connected / Pending) — number
 *                      tinted, label grey, very tight spacing
 *                    · credits-used line on a top-bordered footer
 *                    · whole card is tappable → /campaigns/:id
 *
 *   4. Empty      — clean card with one CTA. No FAB on this screen.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  MegaphoneIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  PhoneCallIcon,
  PaperPlaneTiltIcon,
  WalletIcon,
  PlusIcon,
  PhoneSlashIcon,
} from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import {
  TatvaColors,
  Radius,
  Type,
  StatusToTatva,
  CampaignStatus,
} from '../../src/constants/theme';
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
  const { t } = useTranslation();
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

  const counts = {
    total:      campaigns.length,
    completed:  campaigns.filter((c) => c.status === 'completed').length,
    pending:    campaigns.filter((c) => c.status === 'scheduled' || c.status === 'scheduling').length,
    processing: campaigns.filter((c) => c.status === 'active').length,
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={TatvaColors.surfaceSecondary} />

      {/* ─── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.brandTile}>
            <Text style={styles.brandTileText}>M</Text>
          </View>
          <Text style={styles.headerTitle}>{t('campaigns.title')}</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onRefresh}
          activeOpacity={0.6}
          accessibilityLabel="Refresh campaigns"
        >
          <ArrowsClockwiseIcon size={20} color={TatvaColors.contentSecondary} weight="regular" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={TatvaColors.indigoContent} size="large" />
        </View>
      ) : campaigns.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <PhoneSlashIcon size={20} color={TatvaColors.contentPrimary} weight="regular" />
          </View>
          <Text style={styles.emptyTitle}>{t('campaigns.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('campaigns.emptyBody')}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/campaigns/new')}
            activeOpacity={0.9}
          >
            <PlusIcon size={14} color={TatvaColors.contentInverse} weight="bold" />
            <Text style={styles.primaryBtnText}>{t('campaigns.newCampaign')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={campaigns}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={TatvaColors.indigoContent}
            />
          }
          ListHeaderComponent={
            <StatBar
              total={counts.total}
              completed={counts.completed}
              pending={counts.pending}
              processing={counts.processing}
            />
          }
          renderItem={({ item }) => (
            <CampaignCard item={item} onPress={() => router.push(`/campaigns/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Stat bar ─────────────────────────────────────────────────────────────
function StatBar(props: {
  total: number;
  completed: number;
  pending: number;
  processing: number;
}) {
  const { t } = useTranslation();
  return (
    <View style={statStyles.bar}>
      <Stat value={props.total}      label={t('campaigns.stats.total')}      tone={TatvaColors.contentPrimary} />
      <Divider />
      <Stat value={props.completed}  label={t('campaigns.stats.completed')}  tone={TatvaColors.positiveContent} />
      <Divider />
      <Stat value={props.pending}    label={t('campaigns.stats.pending')}    tone={TatvaColors.warningContent} />
      <Divider />
      <Stat value={props.processing} label={t('campaigns.stats.processing')} tone={TatvaColors.indigoContent} />
    </View>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <View style={statStyles.cell}>
      <Text style={[statStyles.value, { color: tone }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={statStyles.divider} />;
}

// ─── Campaign card ────────────────────────────────────────────────────────
function CampaignCard({ item, onPress }: { item: CampaignRow; onPress: () => void }) {
  const status = StatusToTatva[item.status as CampaignStatus] || StatusToTatva.scheduled;
  const sent = item.totalContacts ?? 0;
  const connected = item.completedCount ?? 0;
  const pending = Math.max(sent - connected, 0);
  const date = formatDate(item.createdAt);
  const StatusIconCmp = statusIconFor(item.status);

  return (
    <TouchableOpacity style={cardStyles.card} activeOpacity={0.8} onPress={onPress}>
      <View style={cardStyles.topRow}>
        <View style={cardStyles.titleRow}>
          <View style={cardStyles.iconTile}>
            <MegaphoneIcon size={16} color={TatvaColors.contentPrimary} weight="regular" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={cardStyles.title} numberOfLines={1}>{item.name}</Text>
            <Text style={cardStyles.date}>{date}</Text>
          </View>
        </View>
        <View style={[cardStyles.chip, { backgroundColor: status.bg }]}>
          <StatusIconCmp size={11} color={status.fg} weight="bold" />
          <Text style={[cardStyles.chipText, { color: status.fg }]}>
            {status.label}
          </Text>
        </View>
      </View>

      <View style={cardStyles.kpiRow}>
        <Kpi
          icon={<PaperPlaneTiltIcon size={12} color={TatvaColors.contentTertiary} weight="regular" />}
          label="Targeted"
          value={sent}
          tone={TatvaColors.contentPrimary}
        />
        <Kpi
          icon={<CheckCircleIcon size={12} color={TatvaColors.positiveContent} weight="regular" />}
          label="Connected"
          value={connected}
          tone={TatvaColors.positiveContent}
        />
        <Kpi
          icon={<ClockIcon size={12} color={TatvaColors.dangerContent} weight="regular" />}
          label="Pending"
          value={pending}
          tone={TatvaColors.dangerContent}
        />
      </View>

      <View style={cardStyles.creditsRow}>
        <WalletIcon size={12} color={TatvaColors.contentTertiary} weight="regular" />
        <Text style={cardStyles.creditsText}>
          Credits used:{' '}
          <Text style={{ color: TatvaColors.contentPrimary, fontWeight: '600' }}>
            {item.creditsCharged ?? 0}
          </Text>
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <View style={cardStyles.kpi}>
      {icon}
      <Text style={cardStyles.kpiLabel}>{label}:</Text>
      <Text style={[cardStyles.kpiValue, { color: tone }]}>{value}</Text>
    </View>
  );
}

function statusIconFor(status: string) {
  switch (status) {
    case 'completed': return CheckCircleIcon;
    case 'failed':    return XCircleIcon;
    case 'cancelled': return XCircleIcon;
    case 'active':
    case 'scheduling':
      return PhoneCallIcon;
    default:          return ClockIcon;
  }
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '';
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  const time = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
  return `${day} ${month} ${year}, ${time}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: TatvaColors.borderSecondary,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTile: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: TatvaColors.indigoContent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTileText: {
    color: TatvaColors.contentInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TatvaColors.contentPrimary,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyIcon: {
    width: 48,
    height: 48,
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
  },
  emptyText: {
    fontSize: 13,
    color: TatvaColors.contentSecondary,
    textAlign: 'center',
    marginBottom: 18,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: TatvaColors.brandPrimary,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
  },
  primaryBtnText: {
    color: TatvaColors.contentInverse,
    fontWeight: '600',
    fontSize: 14,
  },
});

const statStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    paddingVertical: 16,
    marginBottom: 14,
  },
  cell: { flex: 1, alignItems: 'center' },
  value: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: TatvaColors.contentTertiary,
    marginTop: 4,
    letterSpacing: 0.6,
  },
  divider: {
    width: 1,
    backgroundColor: TatvaColors.borderPrimary,
    marginVertical: 4,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: TatvaColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: TatvaColors.contentPrimary,
  },
  date: {
    fontSize: 11,
    color: TatvaColors.contentTertiary,
    marginTop: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  chipText: { fontSize: 11, fontWeight: '600' },

  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  kpi: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  kpiLabel: {
    fontSize: 12,
    color: TatvaColors.contentSecondary,
    marginLeft: 2,
  },
  kpiValue: {
    fontSize: 13,
    fontWeight: '700',
  },

  creditsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: TatvaColors.borderPrimary,
  },
  creditsText: {
    fontSize: 12,
    color: TatvaColors.contentSecondary,
  },
});
