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

import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { Radius, Type } from '../../src/constants/theme';
import type { TatvaColorTokens } from '../../src/constants/theme';
import { useAppTheme } from '../../src/theme/AppThemeProvider';

interface AgentSummary {
  id: string;
  name: string | null;
  industry: string | null;
  language: string | null;
  phoneNumber: string | null;
  status: 'creating' | 'ready' | 'failed';
  summaryNL: { whatItDoes?: string };
}

function useAgentsThemeStyles() {
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme.colors]);
  return { ...theme, styles };
}

export default function AgentsIndexScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, scheme, styles } = useAgentsThemeStyles();
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
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.surfaceSecondary}
      />

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
          <ActivityIndicator color={colors.indigoContent} size="large" />
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
            <PlusIcon size={14} color={colors.contentInverse} weight="bold" />
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
              tintColor={colors.indigoContent}
            />
          }
          renderItem={({ item }) => <AgentRow item={item} onPress={() => router.push(`/agent-preview/${item.id}`)} />}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.addCta}
              onPress={() => router.push('/agents/new')}
              activeOpacity={0.7}
            >
              <PlusIcon size={14} color={colors.contentSecondary} weight="regular" />
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
  const { t } = useTranslation();
  const { colors, styles } = useAgentsThemeStyles();
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
          {item.name || t('agents.unnamedAgent')}
        </Text>
        {item.phoneNumber ? (
          <View style={styles.metaRow}>
            <PhoneIcon size={11} color={colors.contentTertiary} weight="regular" />
            <Text style={styles.meta} numberOfLines={1}>
              {item.phoneNumber}
            </Text>
          </View>
        ) : null}
      </View>
      {!isReady && (
        <View style={[styles.chip, item.status === 'failed' && styles.chipFailed]}>
          {StatusIco ? <StatusIco size={10} color={colors.warningContent} weight="regular" /> : null}
          <Text style={[styles.chipText, item.status === 'failed' && styles.chipTextFailed]}>
            {item.status === 'creating' ? t('agents.status.settingUp') : t('agents.status.failed')}
          </Text>
        </View>
      )}
      <CaretRightIcon size={16} color={colors.contentTertiary} weight="regular" />
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const makeStyles = (colors: TatvaColorTokens) => StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.surfacePrimary },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSecondary,
  },
  backBtn: { alignSelf: 'flex-start', marginBottom: 8 },
  backTxt: { fontSize: 14, color: colors.contentSecondary, fontWeight: '500' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.contentPrimary,
  },
  subtitle: {
    ...Type.bodySm,
    color: colors.contentTertiary,
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
    color: colors.contentPrimary,
  },
  emptyText: {
    fontSize: 13,
    color: colors.contentSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
  },
  primaryBtnText: {
    color: colors.contentInverse,
    fontWeight: '600',
    fontSize: 14,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSecondary,
    padding: 14,
    marginBottom: 10,
  },
  medallion: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.borderSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallionText: {
    color: colors.contentPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.contentPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: colors.contentTertiary,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: colors.warningBackground,
  },
  chipFailed: { backgroundColor: colors.dangerBackground },
  chipText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.warningContent,
  },
  chipTextFailed: { color: colors.dangerContent },

  addCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSecondary,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    marginTop: 4,
  },
  addCtaText: {
    color: colors.contentSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
