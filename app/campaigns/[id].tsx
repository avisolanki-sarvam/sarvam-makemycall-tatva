// TODO(visual-refresh): The April 2026 mockups specify a leaner "Calling-now"
// header for this screen — 3 stat cards (Done / Ringing / Queued) + a status
// list with dot prefixes + "View full report" outlined CTA. The current screen
// serves a broader purpose (post-launch detail AND historical browsing from
// /history/[id]), so it includes a 4-up KPI row, per-call rows with avatars +
// outcome chips + duration, a credits line, cancel link, and click-through to
// per-call detail. A pure mockup port would lose the historical-browsing
// affordances. Plan: split into a transient `CallingNowHeader` (rendered while
// status is `scheduling` or `active`) and the existing `CampaignSummary`
// header (rendered once status hits a terminal state). Tracked separately —
// out of scope for the importer rewire PR.
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
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
import { useTranslation } from 'react-i18next';
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

// Map backend campaign status to the campaigns.status.* i18n key suffix.
// 'active' → 'calling', 'completed' → 'done'. Used when status labels need
// to be rendered via the campaigns.status.* namespace (e.g. compact status
// pill, list-row tag); the inline if/else in the header keeps headerXxx
// keys for finer wording.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function statusToKey(status: string | undefined | null): string {
  switch (status) {
    case 'active': return 'calling';
    case 'completed': return 'done';
    case 'scheduling': return 'scheduling';
    case 'scheduled': return 'scheduled';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    default: return 'scheduling';
  }
}

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaignId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const { t } = useTranslation();

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
    Alert.alert(t('campaigns.detail.alerts.cancelTitle'), t('campaigns.detail.alerts.cancelBody'), [
      { text: t('campaigns.detail.alerts.keepGoing'), style: 'cancel' },
      {
        text: t('common.cancel'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/campaigns/${campaignId}/cancel`);
            await fetchAll();
          } catch (e: any) {
            Alert.alert(t('campaigns.detail.alerts.couldNotCancelTitle'), e?.message || t('common.tryAgain'));
          }
        },
      },
    ]);
  };

  // Dedupe call attempts. The backend stores each retry as a separate
  // CallResult row — visible in the wild as e.g. one Anirudh row at 18s
  // (early hang-up, 0 credits) plus a second Anirudh row at 50s (real
  // conversation, 1 credit, transcript). The user thinks of those as
  // "the call to Anirudh", not as two distinct calls.
  //
  // Group by contactPhone (or contactName as a fallback when phone is
  // missing). Within each group:
  //   - "best" = has a transcript first, else longest duration, else
  //     latest calledAt. That's the row whose tap-target opens the
  //     detail page.
  //   - cost is summed across all attempts so credits-used reflects
  //     reality regardless of which row we surface.
  //   - durationSec is summed (total time spent calling that person).
  //   - `attempts` counts retries so the row can render a "+N retry"
  //     badge.
  //
  // This is a presentation-layer fix only. The backend is the source of
  // truth and still records every attempt. A proper backend dedupe
  // (where retries link to a single conversation row) is the long-term
  // fix and tracked separately.
  type GroupedCall = CallRow & { attempts: number };
  const dedupedCalls = useMemo<GroupedCall[]>(() => {
    const byKey = new Map<string, CallRow[]>();
    for (const c of calls) {
      const key = (c.contactPhone || c.contactName || c.id).trim();
      const arr = byKey.get(key) || [];
      arr.push(c);
      byKey.set(key, arr);
    }
    const score = (c: CallRow) =>
      (c.outcomeSummary ? 1_000_000 : 0) +
      (c.durationSec || 0) * 10 +
      (c.calledAt ? new Date(c.calledAt).getTime() / 1_000_000 : 0);
    const out: GroupedCall[] = [];
    for (const [, group] of byKey) {
      const sorted = [...group].sort((a, b) => score(b) - score(a));
      const best = sorted[0];
      const totalCost = group.reduce((sum, c) => sum + (c.cost || 0), 0);
      const totalDuration = group.reduce((sum, c) => sum + (c.durationSec || 0), 0);
      out.push({
        ...best,
        cost: totalCost,
        durationSec: totalDuration,
        attempts: group.length,
      });
    }
    // Preserve roughly the same ordering as the raw list — sort by best
    // calledAt descending so the most-recent contact lands first.
    out.sort((a, b) => {
      const at = a.calledAt ? new Date(a.calledAt).getTime() : 0;
      const bt = b.calledAt ? new Date(b.calledAt).getTime() : 0;
      return bt - at;
    });
    return out;
  }, [calls]);

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
        <Text style={styles.errorTxt}>{t('campaigns.detail.notFound')}</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.linkTxt}>← {t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const k = campaign.kpis;
  const cancellable = campaign.status === 'scheduled' || campaign.status === 'active';
  const isLive = campaign.status === 'scheduling' || campaign.status === 'active';

  return (
    <View style={styles.container}>
      <FlatList
        data={dedupedCalls}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backTxt}>← {t('common.back')}</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{campaign.name}</Text>
            {isLive && <CallingNowHeader campaign={campaign} calls={calls} />}
            <Text style={styles.subtitle}>
              {campaign.status === 'completed'
                ? t('campaigns.detail.headerDone')
                : campaign.status === 'active'
                  ? t('campaigns.detail.headerCalling')
                  : campaign.status === 'scheduling'
                    ? t('campaigns.detail.headerGettingReady')
                    : campaign.status === 'scheduled'
                      ? t('campaigns.detail.headerScheduled', { when: campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString() : t('campaigns.detail.headerScheduledFallback') })
                      : campaign.status === 'cancelled'
                        ? t('campaigns.detail.headerCancelled')
                        : t('campaigns.detail.headerFailed')}
            </Text>

            <View style={styles.kpiRow}>
              <Kpi label={t('campaigns.detail.kpiConnected')} value={k.connected} bg={COLORS.statusCommittedBg} fg={COLORS.statusCommittedFg} />
              <Kpi label={t('campaigns.detail.kpiNoAnswer')} value={k.noAnswer + k.busy} bg={COLORS.statusMuteBg} fg={COLORS.statusMuteFg} />
              <Kpi label={t('campaigns.detail.kpiFailed')} value={k.failed + k.declined} bg={COLORS.statusDeclinedBg} fg={COLORS.statusDeclinedFg} />
              <Kpi label={t('campaigns.detail.kpiPending')} value={k.pending} bg={COLORS.statusExtensionBg} fg={COLORS.statusExtensionFg} />
            </View>

            <View style={styles.creditLine}>
              <Text style={styles.creditTxt}>
                {t('campaigns.detail.creditsUsed', { used: campaign.creditsCharged, reserved: campaign.creditsReserved })}
              </Text>
              {cancellable && (
                <TouchableOpacity onPress={cancelCampaign}>
                  <Text style={styles.cancelLink}>{t('campaigns.detail.cancel')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sectionLabel}>{t('campaigns.detail.callsTitle')}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>
              {campaign.status === 'active' ? t('campaigns.detail.callsEmptyActive') : t('campaigns.detail.callsEmptyDone')}
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
              <Text style={styles.callName}>{item.contactName || item.contactPhone || t('campaigns.call.unknown')}</Text>
              {item.outcomeSummary ? (
                <Text style={styles.callQuote} numberOfLines={2}>"{item.outcomeSummary}"</Text>
              ) : (
                <Text style={styles.callMeta}>{item.contactPhone}</Text>
              )}
              <View style={styles.callMetaRow}>
                <OutcomeChip connectivity={item.connectivityStatus} outcome={item.outcome} />
                {item.durationSec ? (
                  <Text style={styles.callDuration}>{formatDuration(item.durationSec)}</Text>
                ) : null}
                {/* Retry badge: render only when the contact had >1 call
                    attempt. This is what tells the user "we called them
                    once, then again" without polluting the list with
                    duplicate rows. */}
                {item.attempts > 1 ? (
                  <View style={styles.retryBadge}>
                    <Text style={styles.retryBadgeText}>
                      {t('campaigns.detail.retryBadge', { count: item.attempts - 1 })}
                    </Text>
                  </View>
                ) : null}
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

/**
 * Transient banner shown only while a campaign is in flight (status =
 * `scheduling` | `active`). Unmounts once the campaign reaches a terminal
 * state, letting the existing summary view take over for historical browsing.
 *
 * Counts are derived from the `calls` rows we already fetch:
 *   - Done    : connectivityStatus === 'connected' || completionStatus is set
 *   - Ringing : has been attempted but not yet completed
 *   - Queued  : no attempt yet (no row, or row with no connectivityStatus)
 */
function CallingNowHeader({
  campaign,
  calls,
}: {
  campaign: CampaignDetail;
  calls: CallRow[];
}) {
  const { t } = useTranslation();
  const total = campaign.totalContacts || campaign.kpis.total || 0;

  // A call row exists per attempted contact. Anything without a row is queued.
  const done = calls.filter(
    (c) => c.connectivityStatus === 'connected' || !!c.completionStatus,
  ).length;
  const ringing = calls.filter(
    (c) => c.connectivityStatus !== 'connected' && !c.completionStatus,
  ).length;
  const queued = Math.max(0, total - done - ringing);

  // Most-recent first; newest attempts surface at the top.
  const sorted = [...calls].sort((a, b) => {
    const at = a.calledAt ? new Date(a.calledAt).getTime() : 0;
    const bt = b.calledAt ? new Date(b.calledAt).getTime() : 0;
    return bt - at;
  });
  const VISIBLE_CAP = 10;
  const visible = sorted.slice(0, VISIBLE_CAP);
  const hiddenCount = Math.max(0, sorted.length - visible.length);

  return (
    <View style={styles.cnh}>
      {/* Pulse strip */}
      <View style={styles.cnhPulseRow}>
        <View style={styles.cnhPulseDot} />
        <Text style={styles.cnhPulseTxt}>
          {t('campaigns.detail.now.summary', { total, done, ringing })}
        </Text>
      </View>

      {/* Stat cards */}
      <View style={styles.cnhStatRow}>
        <CnhStat label={t('campaigns.detail.now.done')} value={done} fg={COLORS.success} />
        <CnhStat label={t('campaigns.detail.now.ringing')} value={ringing} fg={COLORS.warning} />
        <CnhStat label={t('campaigns.detail.now.queued')} value={queued} fg={COLORS.textMuted} />
      </View>

      {/* Per-contact status list */}
      {visible.length > 0 && (
        <View style={styles.cnhList}>
          {visible.map((c) => (
            <CnhRow key={c.id} call={c} />
          ))}
          {hiddenCount > 0 && (
            <Text style={styles.cnhViewAll}>{t('campaigns.detail.now.viewAll', { count: sorted.length })}</Text>
          )}
        </View>
      )}
    </View>
  );
}

function CnhStat({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <View style={styles.cnhStat}>
      <Text style={[styles.cnhStatNum, { color: fg }]}>{value}</Text>
      <Text style={styles.cnhStatLabel}>{label}</Text>
    </View>
  );
}

function CnhRow({ call }: { call: CallRow }) {
  const { t } = useTranslation();
  // Map row state to a dot colour + bilingual-leaning label.
  let dot = COLORS.textMuted;
  let label = t('campaigns.detail.outcome.queued');
  if (call.connectivityStatus === 'connected' || call.completionStatus) {
    dot = COLORS.success;
    label = t('campaigns.detail.outcome.connected');
  } else if (
    call.connectivityStatus === 'no_answer' ||
    call.connectivityStatus === 'busy'
  ) {
    dot = COLORS.textMuted;
    label = call.connectivityStatus === 'busy' ? t('campaigns.detail.outcome.busy') : t('campaigns.detail.outcome.noAnswer');
  } else if (call.connectivityStatus === 'failed') {
    dot = COLORS.danger;
    label = t('campaigns.detail.outcome.failed');
  } else if (call.calledAt) {
    dot = COLORS.warning;
    label = t('campaigns.detail.outcome.ringing');
  }
  return (
    <View style={styles.cnhRow}>
      <View style={[styles.cnhDot, { backgroundColor: dot }]} />
      <Text style={styles.cnhRowName} numberOfLines={1}>
        {call.contactName || call.contactPhone || t('campaigns.call.unknown')}
      </Text>
      <Text style={[styles.cnhRowTag, { color: dot }]}>{label}</Text>
    </View>
  );
}

function OutcomeChip({ connectivity, outcome }: { connectivity: string | null; outcome: string | null }) {
  const { t } = useTranslation();
  // BUG FIX (Apr 2026): the previous logic merged connectivity values
  // and conversation-outcome values into one map and let `outcome` win,
  // which meant a 110-second connected call whose AI conversation
  // outcome was "no_answer" ("the customer didn't give a clear reply
  // to my question") rendered identically to a phone-never-rang
  // connectivity "no_answer". The two states share a label but mean
  // entirely different things.
  //
  // New rule: connectivity gates everything. If the call didn't connect,
  // we show the connectivity bucket — there's no meaningful outcome
  // from a phone that didn't pick up. If the call DID connect, we show
  // the conversation outcome (or a generic "Connected" if outcome is
  // null). Conversation `outcome === 'no_answer'` is relabelled to
  // "Couldn't get a reply" / "Unclear" so it never reads as
  // "phone didn't ring".
  const isConnected =
    connectivity === 'connected' ||
    // Some pipelines flip completion before connectivity lands; treat
    // any non-empty outcome as evidence we got a conversation.
    (!!outcome && connectivity !== 'failed' && connectivity !== 'busy' && connectivity !== 'no_answer');

  const connectivityMap: Record<string, { bg: string; fg: string; labelKey: string }> = {
    no_answer: { bg: COLORS.statusMuteBg,     fg: COLORS.statusMuteFg,     labelKey: 'campaigns.detail.outcome.noAnswer' },
    busy:      { bg: COLORS.statusMuteBg,     fg: COLORS.statusMuteFg,     labelKey: 'campaigns.detail.outcome.busy' },
    failed:    { bg: COLORS.statusDeclinedBg, fg: COLORS.statusDeclinedFg, labelKey: 'campaigns.detail.outcome.failed' },
    queued:    { bg: COLORS.statusMuteBg,     fg: COLORS.statusMuteFg,     labelKey: 'campaigns.detail.outcome.queued' },
  };

  // On a connected call, `outcome === 'no_answer'` actually means the
  // AI couldn't get a clear reply — relabel it as "Unclear" so it
  // never collides with the connectivity-noAnswer label.
  const outcomeMap: Record<string, { bg: string; fg: string; labelKey: string }> = {
    committed:  { bg: COLORS.statusCommittedBg, fg: COLORS.statusCommittedFg, labelKey: 'campaigns.detail.outcome.committed' },
    extension:  { bg: COLORS.statusExtensionBg, fg: COLORS.statusExtensionFg, labelKey: 'campaigns.detail.outcome.extension' },
    declined:   { bg: COLORS.statusDeclinedBg,  fg: COLORS.statusDeclinedFg,  labelKey: 'campaigns.detail.outcome.declined' },
    no_clarity: { bg: COLORS.statusExtensionBg, fg: COLORS.statusExtensionFg, labelKey: 'campaigns.detail.outcome.unclear' },
    no_answer:  { bg: COLORS.statusExtensionBg, fg: COLORS.statusExtensionFg, labelKey: 'campaigns.detail.outcome.unclear' },
    connected:  { bg: COLORS.statusCommittedBg, fg: COLORS.statusCommittedFg, labelKey: 'campaigns.detail.outcome.connected' },
  };

  const m = isConnected
    ? outcomeMap[outcome || 'connected'] || outcomeMap.connected
    : connectivityMap[connectivity || 'queued'] || connectivityMap.queued;

  return (
    <View style={[styles.outcomeChip, { backgroundColor: m.bg }]}>
      <Text style={[styles.outcomeChipText, { color: m.fg }]}>{t(m.labelKey)}</Text>
    </View>
  );
}

/**
 * Format a raw float-second duration into a human-readable label.
 *   110.36898  → "1m 50s"
 *   18.4       → "18s"
 *   3725       → "1h 2m"
 * The previous "{seconds}s" rendering printed "110.36898s" which was
 * neither readable nor trustworthy-looking on the campaign detail.
 */
function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const remSec = total % 60;
  if (mins < 60) return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`;
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
  // Small grey pill that appears on rows where multiple attempts were
  // collapsed into one. e.g. "+1 retry".
  retryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.statusMuteBg,
  },
  retryBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  errorTxt: { fontSize: 14, color: COLORS.danger, marginBottom: 16 },
  linkTxt: { fontSize: 14, fontWeight: '600', color: COLORS.text, paddingVertical: 6 },

  // CallingNowHeader — transient, only while status is scheduling/active.
  cnh: {
    marginTop: 12,
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  cnhPulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cnhPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.warning,
  },
  cnhPulseTxt: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flex: 1,
  },
  cnhStatRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cnhStat: {
    flex: 1,
    backgroundColor: COLORS.statusMuteBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  cnhStatNum: {
    fontSize: 19,
    fontWeight: '500',
  },
  cnhStatLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  cnhList: {
    marginTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  cnhRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderSoft,
  },
  cnhDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  cnhRowName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text,
  },
  cnhRowTag: {
    fontSize: 10,
    fontWeight: '500',
  },
  cnhViewAll: {
    fontSize: 11,
    color: COLORS.textSecondary,
    paddingVertical: 8,
    textAlign: 'center',
  },
});
