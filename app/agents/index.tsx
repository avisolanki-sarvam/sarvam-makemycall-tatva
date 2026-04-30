/**
 * /agents — Manage agents.
 *
 * Lists every agent on the user's account with status, language, and the
 * Samvaad-provisioned phone number. Tapping a row opens the agent preview
 * (the same screen that Home routes into). The header carries a "+ New
 * agent" CTA so this is a complete agent-management surface.
 *
 * Data: GET /agents — same endpoint Home hits. The two screens diverge
 * only in framing — Home is action-first ("start a campaign with this
 * agent"), this screen is registry-first ("here's everything you've got").
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
  CaretRightIcon,
  PlusIcon,
  PhoneIcon,
  ArrowsClockwiseIcon,
} from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/services/api';
import { TatvaColors, Radius, Type } from '../../src/constants/theme';

interface AgentSummary {
  id: string;
  name: string | null;
  industry: string | null;
  language: string | null;
  phoneNumber: string | null;
  status: 'creating' | 'ready' | 'failed';
  summaryNL: { whatItDoes?: string };
}

export default function AgentsIndexScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const res = await api.get<{ agents: AgentSummary[] }>('/agents');
      setAgents(res?.agents || []);
    } catch {
      setAgents([]);
    }
  }, []);

  // Refresh on focus so newly-created agents show up immediately.
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
    }, [fetchList]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchList();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={TatvaColors.surfaceSecondary} />

      {/* ─── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backTxt}>← {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('agents.title')}</Text>
        <Text style={styles.subtitle}>
          {agents.length === 0
            ? t('agents.emptyTitle')
            : t('agents.count', { count: agents.length })}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={TatvaColors.indigoContent} size="large" />
        </View>
      ) : agents.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t('agents.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('agents.emptyBody')}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/agents/new')}
            activeOpacity={0.9}
          >
            <PlusIcon size={14} color={TatvaColors.contentInverse} weight="bold" />
            <Text style={styles.primaryBtnText}>{t('agents.newAgent')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={TatvaColors.indigoContent}
            />
          }
          renderItem={({ item }) => <AgentRow item={item} onPress={() => router.push(`/agent-preview/${item.id}`)} />}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.addCta}
              onPress={() => router.push('/agents/new')}
              activeOpacity={0.7}
            >
              <PlusIcon size={14} color={TatvaColors.contentSecondary} weight="regular" />
              <Text style={styles.addCtaText}>{t('agents.newAgent')}</Text>
            </TouchableOpacity>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Agent row ────────────────────────────────────────────────────────────
function AgentRow({ item, onPress }: { item: AgentSummary; onPress: () => void }) {
  const initials = (item.name || '?').slice(0, 2).toUpperCase();
  const isReady = item.status === 'ready';
  const StatusIco = isReady ? null : item.status === 'creating' ? ArrowsClockwiseIcon : null;

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.medallion}>
        <Text style={styles.medallionText}>{initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name || 'Unnamed assistant'}
        </Text>
        {item.phoneNumber ? (
          <View style={styles.metaRow}>
            <PhoneIcon size={11} color={TatvaColors.contentTertiary} weight="regular" />
            <Text style={styles.meta} numberOfLines={1}>
              {item.phoneNumber}
            </Text>
          </View>
        ) : null}
      </View>
      {!isReady && (
        <View style={[styles.chip, item.status === 'failed' && styles.chipFailed]}>
          {StatusIco ? <StatusIco size={10} color={TatvaColors.warningContent} weight="regular" /> : null}
          <Text style={[styles.chipText, item.status === 'failed' && styles.chipTextFailed]}>
            {item.status === 'creating' ? 'Setting up' : 'Failed'}
          </Text>
        </View>
      )}
      <CaretRightIcon size={16} color={TatvaColors.contentTertiary} weight="regular" />
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: TatvaColors.borderSecondary,
  },
  backBtn: { alignSelf: 'flex-start', marginBottom: 8 },
  backTxt: { fontSize: 14, color: TatvaColors.contentSecondary, fontWeight: '500' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: TatvaColors.contentPrimary,
  },
  subtitle: {
    ...Type.bodySm,
    color: TatvaColors.contentTertiary,
    marginTop: 2,
  },

  listContent: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  emptyTitle: {
    ...Type.headingSm,
    fontWeight: '600',
    color: TatvaColors.contentPrimary,
  },
  emptyText: {
    fontSize: 13,
    color: TatvaColors.contentSecondary,
    textAlign: 'center',
    marginBottom: 16,
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    padding: 14,
    marginBottom: 10,
  },
  medallion: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallionText: {
    color: TatvaColors.contentPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: TatvaColors.contentPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: TatvaColors.contentTertiary,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.warningBackground,
  },
  chipFailed: { backgroundColor: TatvaColors.dangerBackground },
  chipText: {
    fontSize: 10,
    fontWeight: '600',
    color: TatvaColors.warningContent,
  },
  chipTextFailed: { color: TatvaColors.dangerContent },

  addCta: {
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
  addCtaText: {
    color: TatvaColors.contentSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
