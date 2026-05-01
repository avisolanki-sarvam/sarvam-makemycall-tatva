import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../src/constants/api';
import { TatvaColors } from '../../src/constants/theme';
// Tatva-aligned text-field primitive — mirrors the Tatva web `Input` API
// (label, error, helperText, prefix, size 'sm'|'md'|'lg', leading icon).
// Use this instead of raw RN <TextInput> so the wizard inherits the
// system's pill silhouette, focus tone, and helper/error treatment.
import { Input, SearchBar } from '../../src/components/Input';
import { api, readEnvelope } from '../../src/services/api';
import { useContactStore, type Contact } from '../../src/stores/contactStore';
import {
  useCampaignDraftStore,
  type ScheduleMode,
  type AllowedWindow,
} from '../../src/stores/campaignDraftStore';

// Wizard steps. Spec §4.15 (pick agent) is skipped for v1 because the user
// only ever has one agent. Add it back when multi-agent UX lands.
type Step = 'contacts' | 'schedule' | 'variables' | 'review';

const STEP_ORDER: Step[] = ['contacts', 'schedule', 'variables', 'review'];

interface KVRow {
  key: string;
  value: string;
}

const newRow = (): KVRow => ({ key: '', value: '' });

// HH:MM 24h validator. Empty string is rejected (we always render with a
// default seeded from the draft store).
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isValidHHMM = (s: string) => HHMM_RE.test(s);

// Lenient time-input normalizer. Accepts flexible user-entered shapes and
// returns a canonical "HH:MM" or null:
//
//   "8"      → "08:00"
//   "08"     → "08:00"
//   "8:0"    → "08:00"
//   "8:30"   → "08:30"
//   "08:00"  → "08:00"
//   "23:45"  → "23:45"
//   "abc"    → null
//   "25:00"  → null  (out of range)
//
// Used in commit handlers + the step-ready gate so the user can type just
// "8" and "10" without the input slamming back to the default on blur.
function normalizeTimeInput(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2] === undefined ? 0 : parseInt(m[2], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(min) || min < 0 || min > 59) return null;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

// Agent-validate envelope shape. Mirrors the importer's local interface so
// call sites don't need a shared types module for this one boolean.
interface ValidateData {
  valid: boolean;
  agent?: { id: string; status: string; name: string };
}

interface LaunchData {
  campaign?: { id: string };
}

// Tomorrow-at-hour helper for the "schedule for later" preset chips. Server
// constrains the actual call window via allowedWindow; these chips are just
// shortcuts for choosing a start time tomorrow.
function tomorrowAt(hour: number): { iso: string; label: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  const label = d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return { iso: d.toISOString(), label };
}

const SCHEDULE_PRESETS = [
  () => tomorrowAt(9),
  () => tomorrowAt(12),
  () => tomorrowAt(17),
  () => tomorrowAt(19),
];

export default function NewCampaignScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  // Optional ?agentId= picks WHICH agent this campaign belongs to. Used by
  // the home screen's per-agent "Create campaign" buttons in the multi-
  // agent UX. When absent (legacy entry from a tab/+ button), the bootstrap
  // falls back to the first ready agent — same behaviour as before.
  const { agentId: requestedAgentId } = useLocalSearchParams<{ agentId?: string }>();
  const draft = useCampaignDraftStore();
  const { contacts, getFilteredContacts, setContacts, setSearchQuery, searchQuery } =
    useContactStore();

  const [step, setStep] = useState<Step>('contacts');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [varRows, setVarRows] = useState<KVRow[]>([newRow()]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);

  // Local-only mirror of the allowedWindow time inputs so we can validate
  // HH:MM keystroke-by-keystroke without polluting the draft store with
  // half-typed values. Committed to draft on blur.
  const [startTimeText, setStartTimeText] = useState<string>(draft.allowedWindow.startTime);
  const [endTimeText, setEndTimeText] = useState<string>(draft.allowedWindow.endTime);

  // Pre-flight validate (fires once on review-step entry; mirrors importer).
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateErrorCode, setValidateErrorCode] = useState<string | null>(null);

  // Reset draft + load supporting data on first mount.
  useEffect(() => {
    draft.reset();
    setSearchQuery('');
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the local time-text mirrors in sync after a draft.reset().
  useEffect(() => {
    setStartTimeText(draft.allowedWindow.startTime);
    setEndTimeText(draft.allowedWindow.endTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.allowedWindow.startTime, draft.allowedWindow.endTime]);

  const bootstrap = async () => {
    setLoading(true);
    setError(null);
    try {
      const [contactsRes, dashboardRes, agentsRes] = await Promise.all([
        api.get<{ contacts: Contact[] }>('/contacts').catch(() => ({ contacts: [] })),
        api.get<any>('/user/dashboard').catch(() => null),
        api.get<{ agents: { id: string; name: string }[] }>('/agents').catch(() => ({ agents: [] })),
      ]);
      setContacts(contactsRes?.contacts || []);
      setCreditBalance(dashboardRes?.creditBalance ?? 0);
      // Prefer the explicitly-requested agent when caller passed ?agentId=
      // (multi-agent UX). Fall back to the first ready agent so legacy
      // entry points (no param) keep working.
      const allAgents = agentsRes?.agents ?? [];
      const a =
        (requestedAgentId && allAgents.find((x) => x.id === requestedAgentId)) ||
        allAgents[0];
      if (a) {
        setAgentId(a.id);
        setAgentName(a.name);
      }
    } catch (e: any) {
      setError(e?.message || t('campaigns.new.couldNotLoadFallback'));
    } finally {
      setLoading(false);
    }
  };

  const stepIndex = STEP_ORDER.indexOf(step);

  const goPrev = () => {
    if (stepIndex === 0) {
      router.back();
      return;
    }
    setStep(STEP_ORDER[stepIndex - 1]);
  };
  const goNext = () => {
    if (stepIndex === STEP_ORDER.length - 1) return;
    setStep(STEP_ORDER[stepIndex + 1]);
  };

  // ------------------------------------------------------------------ Pre-flight validate
  // Same shape as importer review: fire POST /agents/:id/validate once when
  // we land on the review step. Result gates the launch CTA. We don't block
  // the rest of the wizard on this — the user can still edit prior steps.
  useEffect(() => {
    if (step !== 'review' || !agentId) return;
    let cancelled = false;
    (async () => {
      setValidating(true);
      setValid(null);
      setValidateError(null);
      setValidateErrorCode(null);
      try {
        const raw = await api.post<any>(`/agents/${agentId}/validate`, {});
        if (cancelled) return;
        const env = readEnvelope<ValidateData>(raw);
        if (env.ok && env.data?.valid) {
          setValid(true);
        } else {
          setValid(false);
          setValidateError(env.hint || raw?.errors?.[0]?.hint || t('campaigns.new.assistantNotReady'));
          setValidateErrorCode(raw?.errors?.[0]?.code || null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setValid(false);
        setValidateError(err?.message || t('campaigns.new.couldNotCheckAssistant'));
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, agentId]);

  // ------------------------------------------------------------------ Launch

  const buildVarsObject = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of varRows) {
      const k = r.key.trim();
      const v = r.value.trim();
      if (k && v) out[k] = v;
    }
    return out;
  };

  // Same recovery taxonomy as the importer; codes come from
  // api/services/Agent.js validateAgent. Keep in sync.
  const RECREATE_CODES = useMemo(
    () => new Set(['agent_no_phone', 'agent_variables_missing', 'agent_not_provisioned']),
    [],
  );
  const showRecreate = !!validateErrorCode && RECREATE_CODES.has(validateErrorCode);

  const launch = async () => {
    if (!agentId) {
      Alert.alert(t('campaigns.new.alerts.noAgentTitle'), t('campaigns.new.alerts.noAgentBody'));
      return;
    }
    if (draft.selectedContactIds.length === 0) {
      Alert.alert(t('campaigns.new.alerts.noContactsTitle'), t('campaigns.new.alerts.noContactsBody'));
      return;
    }
    if (valid !== true) {
      // Defensive — the CTA should already be disabled in this case.
      Alert.alert(t('campaigns.new.alerts.agentNotReadyTitle'), validateError || t('campaigns.new.alerts.agentNotReadyBody'));
      return;
    }
    const cost = draft.selectedContactIds.length;
    if (creditBalance < cost) {
      Alert.alert(
        t('campaigns.new.alerts.needCreditsTitle'),
        t('campaigns.new.alerts.needCreditsBody', { cost, balance: creditBalance }),
      );
      return;
    }

    setSubmitting(true);
    try {
      const defaultVariables = buildVarsObject();
      // Body shape matches POST /agents/:id/launch contract exactly.
      // contactIds is preferred when we have selections from the address
      // book, which is the only path this wizard takes.
      const payload: Record<string, any> = {
        contactIds: draft.selectedContactIds,
        allowedWindow: draft.allowedWindow,
      };
      if (Object.keys(defaultVariables).length > 0) {
        payload.defaultVariables = defaultVariables;
      }
      if (draft.scheduleMode === 'later' && draft.scheduledAt) {
        payload.scheduledAt = draft.scheduledAt;
      }
      const raw = await api.post<any>(`/agents/${agentId}/launch`, payload);
      const env = readEnvelope<LaunchData>(raw);
      if (env.ok && env.data?.campaign?.id) {
        draft.reset();
        router.replace(`/campaigns/${env.data.campaign.id}`);
        return;
      }
      // 200 with success=false (insufficient credits, agent not ready, etc.)
      Alert.alert(t('campaigns.new.alerts.couldNotLaunchTitle'), env.hint || t('common.tryAgain'));
    } catch (e: any) {
      Alert.alert(t('campaigns.new.alerts.couldNotLaunchTitle'), e?.message || t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------ UI bits

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <TouchableOpacity onPress={goPrev} hitSlop={12} style={styles.backBtn}>
        <Text style={styles.backTxt}>← {t('common.back')}</Text>
      </TouchableOpacity>
      <StepProgress current={stepIndex} total={STEP_ORDER.length} />
      <Text style={styles.title}>{title}</Text>
    </View>
  );

  // 4-segment progress bar. Completed segments fill solid (brand inverse on
  // dark, brand primary on light); the current segment uses the indigo
  // accent; future segments stay neutral. No glyph inside — the colour
  // alone communicates progress, matching Tatva's `Stepper` (simple track
  // segments, no per-step check icon). Replaces the prior "Step 1 of 4"
  // text and the noisier check-per-segment variant.
  function StepProgress({ current, total }: { current: number; total: number }) {
    return (
      <View style={styles.progressRow}>
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < current;
          const isCurrent = i === current;
          return (
            <View
              key={i}
              style={[
                styles.progressSeg,
                isDone && styles.progressSegDone,
                isCurrent && styles.progressSegCurrent,
              ]}
            />
          );
        })}
      </View>
    );
  }

  // ------------------------------------------------------------------ Contacts step

  const filtered = getFilteredContacts();

  // Whole-store check (filtered.length is a per-search filter; we want to
  // know if there are zero saved contacts at all so the empty-state
  // path-of-no-search-input renders correctly).
  const hasAnyContacts = contacts.length > 0;

  const renderContactsStep = () => (
    <>
      {renderHeader(t('campaigns.new.step1Title'))}

      {/* When there are zero saved contacts, hide the search bar entirely
          — its presence was misleading users into thinking they could type
          a new contact's name there. Show only a strong empty state with
          a primary CTA that drops them onto the Contacts tab. */}
      {!hasAnyContacts ? (
        <View style={styles.emptyHero}>
          <Text style={styles.emptyHeroTitle}>
            {t('campaigns.new.noContactsTitle')}
          </Text>
          <Text style={styles.emptyHeroBody}>
            {t('campaigns.new.noContactsBody')}
          </Text>
          <TouchableOpacity
            style={styles.emptyHeroCta}
            onPress={() => router.push('/(tabs)/contacts')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyHeroCtaText}>
              {t('campaigns.new.goAddContacts')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Search row — leading magnifying-glass icon + a "manage" link
              on the right so the user always has an escape hatch from the
              wizard back to the Contacts tab. Uses the Tatva SearchBar
              primitive: pill silhouette + built-in clear (×). */}
          <View style={styles.searchRow}>
            <View style={{ flex: 1 }}>
              <SearchBar
                placeholder={t('campaigns.new.searchPlaceholder')}
                value={searchQuery}
                onChangeText={setSearchQuery}
                size="md"
              />
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/contacts')}
              hitSlop={6}
              style={styles.manageBtn}
            >
              <Text style={styles.manageBtnText}>
                {t('campaigns.new.manage')}
              </Text>
            </TouchableOpacity>
          </View>

          {filtered.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>
                {t('campaigns.new.noMatchesTitle')}
              </Text>
              <Text style={styles.emptyText}>
                {t('campaigns.new.noMatchesBody')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
              renderItem={({ item }) => {
                const picked = draft.selectedContactIds.includes(item.id);
                const subtitle = subtitleFor(item);
                return (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={[styles.contactCard, picked && styles.contactCardPicked]}
                    onPress={() => draft.toggleContact(item.id)}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{item.name}</Text>
                      <Text style={styles.contactSub} numberOfLines={1}>{subtitle}</Text>
                    </View>
                    <View style={[styles.check, picked && styles.checkPicked]}>
                      {picked && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </>
      )}

      {/* Footer is rendered only when the user has contacts to pick from
          — without any contacts there's nothing to advance to. */}
      {hasAnyContacts ? (
        <View style={styles.footer}>
          <Text style={styles.footerSummary}>
            {draft.selectedContactIds.length > 0
              ? t('campaigns.new.selectedCount', { count: draft.selectedContactIds.length })
              : t('campaigns.new.pickAtLeastOne')}
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, draft.selectedContactIds.length === 0 && styles.btnDisabled]}
            disabled={draft.selectedContactIds.length === 0}
            onPress={goNext}
          >
            <Text style={styles.primaryBtnText}>{t('campaigns.new.nextSchedule')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  );

  // ------------------------------------------------------------------ Schedule step

  // Time inputs commit to the draft on blur. We accept lenient input shapes
  // ("8", "08", "8:30") via normalizeTimeInput, then write the canonical
  // "HH:MM" form back into both the local mirror AND the draft. Only fully
  // un-parseable values revert to the previous draft value.
  const commitStartTime = () => {
    const normalized = normalizeTimeInput(startTimeText);
    if (normalized) {
      setStartTimeText(normalized);
      draft.patchAllowedWindow({ startTime: normalized });
    } else {
      setStartTimeText(draft.allowedWindow.startTime);
    }
  };
  const commitEndTime = () => {
    const normalized = normalizeTimeInput(endTimeText);
    if (normalized) {
      setEndTimeText(normalized);
      draft.patchAllowedWindow({ endTime: normalized });
    } else {
      setEndTimeText(draft.allowedWindow.endTime);
    }
  };

  // Gate the Next button on:
  //   - if "later" picked, scheduledAt must be set
  //   - both time inputs must normalise to a valid HH:MM
  //   - end > start (string compare works for fixed-width HH:MM)
  const normalizedStart = normalizeTimeInput(startTimeText);
  const normalizedEnd   = normalizeTimeInput(endTimeText);
  const scheduleStepReady =
    !!normalizedStart &&
    !!normalizedEnd &&
    normalizedStart < normalizedEnd &&
    !(draft.scheduleMode === 'later' && !draft.scheduledAt);

  const renderScheduleStep = () => (
    <ScrollView contentContainerStyle={styles.contentPad}>
      {renderHeader(t('campaigns.new.step2Title'))}

      <RadioRow
        active={draft.scheduleMode === 'now'}
        title={t('campaigns.new.callNow')}
        subtitle={t('campaigns.new.callNowSub')}
        onPress={() => {
          draft.setScheduleMode('now');
          draft.setScheduledAt(null);
        }}
      />
      <RadioRow
        active={draft.scheduleMode === 'later'}
        title={t('campaigns.new.scheduleLater')}
        subtitle={t('campaigns.new.scheduleLaterSub')}
        onPress={() => draft.setScheduleMode('later')}
      />

      {draft.scheduleMode === 'later' && (
        <View style={styles.presetWrap}>
          <Text style={styles.presetLabel}>{t('campaigns.new.pickATime')}</Text>
          <View style={styles.presetRow}>
            {SCHEDULE_PRESETS.map((p, i) => {
              const { iso, label } = p();
              const active = draft.scheduledAt === iso;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.preset, active && styles.presetActive]}
                  onPress={() => draft.setScheduledAt(iso)}
                >
                  <Text style={[styles.presetText, active && styles.presetTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Allowed-window — call timing window. Hardcoded Asia/Kolkata + a
          single weekday (today's by default; backend accepts up to all 7).
          The day picker is intentionally minimal for v1 — most customers run
          the whole campaign in one sitting. */}
      <View style={styles.windowBlock}>
        <Text style={styles.windowLabelHi}>{t('campaigns.new.windowTitle')}</Text>
        <Text style={styles.windowLabelEn}>{t('campaigns.new.windowSub')}</Text>
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Input
              label={t('campaigns.new.fromLabel')}
              value={startTimeText}
              onChangeText={setStartTimeText}
              onBlur={commitStartTime}
              placeholder={t('campaigns.new.fromPlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoCorrect={false}
              size="sm"
              error={!normalizedStart && startTimeText ? ' ' : undefined}
            />
          </View>
          <View style={styles.timeField}>
            <Input
              label={t('campaigns.new.toLabel')}
              value={endTimeText}
              onChangeText={setEndTimeText}
              onBlur={commitEndTime}
              placeholder={t('campaigns.new.toPlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoCorrect={false}
              size="sm"
              error={!normalizedEnd && endTimeText ? ' ' : undefined}
            />
          </View>
        </View>
        <Text style={styles.windowHint}>
          {t('campaigns.new.windowHint')}
        </Text>
        {normalizedStart &&
          normalizedEnd &&
          normalizedStart >= normalizedEnd && (
            <Text style={styles.windowError}>{t('campaigns.new.windowError')}</Text>
          )}
      </View>

      <View style={[styles.footer, { marginTop: 24 }]}>
        <View />
        <TouchableOpacity
          style={[styles.primaryBtn, !scheduleStepReady && styles.btnDisabled]}
          disabled={!scheduleStepReady}
          onPress={goNext}
        >
          <Text style={styles.primaryBtnText}>{t('campaigns.new.nextVariables')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ------------------------------------------------------------------ Variables step

  const renderVariablesStep = () => (
    <ScrollView contentContainerStyle={styles.contentPad}>
      {renderHeader(t('campaigns.new.varsTitle'))}
      <Text style={styles.hint}>
        {t('campaigns.new.varsSub')}
      </Text>

      {varRows.map((row, i) => (
        <View key={i} style={styles.kvRow}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder={t('campaigns.new.fieldPlaceholder')}
              value={row.key}
              onChangeText={(text) =>
                setVarRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, key: text } : r)))
              }
              size="sm"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <Input
              placeholder={t('campaigns.new.valuePlaceholder')}
              value={row.value}
              onChangeText={(text) =>
                setVarRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, value: text } : r)))
              }
              size="sm"
            />
          </View>
          <TouchableOpacity
            style={styles.kvRemove}
            onPress={() =>
              setVarRows((rs) => (rs.length === 1 ? [newRow()] : rs.filter((_, idx) => idx !== i)))
            }
          >
            <Text style={styles.kvRemoveTxt}>−</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={() => setVarRows((rs) => [...rs, newRow()])}>
        <Text style={styles.linkTxt}>{t('campaigns.new.addAnother')}</Text>
      </TouchableOpacity>

      <View style={[styles.footer, { marginTop: 24 }]}>
        <TouchableOpacity onPress={goNext}>
          <Text style={styles.linkTxt}>{t('common.skip')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={goNext}>
          <Text style={styles.primaryBtnText}>{t('campaigns.new.nextReview')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ------------------------------------------------------------------ Review step

  const formatAllowedWindow = (w: AllowedWindow): string => {
    const days =
      w.days.length === 7
        ? t('campaigns.new.everyDay')
        : w.days.length === 0
          ? '—'
          : w.days.join(', ');
    return `${w.startTime}–${w.endTime} ${w.timezone}  •  ${days}`;
  };

  const renderReviewStep = () => {
    const cost = draft.selectedContactIds.length;
    const balanceAfter = creditBalance - cost;
    const selected = draft.selectedContactIds
      .map((id) => contacts.find((c) => c.id === id)?.name)
      .filter(Boolean) as string[];
    const vars = buildVarsObject();
    const scheduleLabel =
      draft.scheduleMode === 'now'
        ? t('campaigns.new.summaryWhenNow')
        : draft.scheduledAt
          ? new Date(draft.scheduledAt).toLocaleString()
          : t('campaigns.new.summaryWhenLater');

    const launchDisabled =
      submitting ||
      validating ||
      valid !== true ||
      balanceAfter < 0 ||
      draft.selectedContactIds.length === 0;

    const namesShort = selected.slice(0, 3).join(', ');
    const whoValue = selected.length > 3
      ? t('campaigns.new.summaryWhoSelectedMore', { count: selected.length, names: namesShort, extra: selected.length - 3 })
      : t('campaigns.new.summaryWhoSelected', { count: selected.length, names: namesShort });

    return (
      <ScrollView contentContainerStyle={styles.contentPad}>
        {renderHeader(t('campaigns.new.reviewTitle'))}

        <SummaryRow label={t('campaigns.new.summaryAssistant')} value={agentName || '—'} />
        <SummaryRow label={t('campaigns.new.summaryWhen')} value={scheduleLabel} />
        <SummaryRow label={t('campaigns.new.summaryWindow')} value={formatAllowedWindow(draft.allowedWindow)} />
        <SummaryRow
          label={t('campaigns.new.summaryWho')}
          value={whoValue}
        />
        {Object.keys(vars).length > 0 && (
          <SummaryRow
            label={t('campaigns.new.summarySharedDetails')}
            value={Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('  •  ')}
          />
        )}

        <View style={styles.costCard}>
          <Text style={styles.costLine}>
            {t('campaigns.new.callsTimes', { count: cost, cost })}
          </Text>
          <Text style={styles.costSub}>
            {t('campaigns.new.balanceAfter', { balance: balanceAfter })}
            {balanceAfter < 0 ? t('campaigns.new.needMoreCreditsSuffix') : ''}
          </Text>
        </View>

        {/* Validate banner — surfaces when the agent isn't callable. Mirrors
            the importer's banner: warm hint copy + recovery link. While the
            banner is up, the launch CTA below stays disabled. */}
        {valid === false && validateError ? (
          <View style={styles.validateBanner}>
            <Text style={styles.validateBannerText}>{validateError}</Text>
            <TouchableOpacity
              style={styles.validateRetryBtn}
              onPress={() => {
                if (showRecreate && agentId) {
                  router.push(`/agent-preview/${agentId}`);
                } else {
                  // Soft re-fire: bounce out and back into review. The
                  // step-change effect re-runs validate.
                  setStep('variables');
                  setTimeout(() => setStep('review'), 30);
                }
              }}
            >
              <Text style={styles.validateRetryText}>
                {showRecreate ? t('campaigns.new.recreate') : t('campaigns.new.tryAgain')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* PRIMARY: bilingual stacked launch CTA. Matches importer pattern. */}
        <TouchableOpacity
          style={[styles.cta, launchDisabled && styles.ctaDisabled]}
          disabled={launchDisabled}
          onPress={launch}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : validating ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.ctaTextHi}>{t('campaigns.new.checking')}</Text>
              <Text style={styles.ctaTextEn}>{t('campaigns.new.verifyingAgent')}</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.ctaTextHi}>{t('campaigns.new.launchBilingualHi')}</Text>
              <Text style={styles.ctaTextEn}>{t('campaigns.new.launchBilingualEn')}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* SECONDARY: outlined "Edit" — bounces back to step 1 so the user
            can revise contacts / schedule / variables. */}
        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={() => setStep('contacts')}
          activeOpacity={0.85}
        >
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.secondaryCtaTextHi}>{t('campaigns.new.editHi')}</Text>
            <Text style={styles.secondaryCtaTextEn}>{t('campaigns.new.editEn')}</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ------------------------------------------------------------------ Render

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorTxt}>{error}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={bootstrap}>
          <Text style={styles.primaryBtnText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {step === 'contacts' && renderContactsStep()}
      {step === 'schedule' && renderScheduleStep()}
      {step === 'variables' && renderVariablesStep()}
      {step === 'review' && renderReviewStep()}
    </View>
  );
}

// ----------------------------------------------------------------- Sub-views

function RadioRow({
  active,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={[styles.radio, active && styles.radioActive]}>
      <View style={[styles.dot, active && styles.dotActive]}>{active && <View style={styles.dotInner} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.radioTitle}>{title}</Text>
        <Text style={styles.radioSub}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

// Same precedence as the contacts tab: first non-empty custom-field "key: value" → notes preview → phone.
function subtitleFor(c: Contact): string {
  const cf = c.customFields || {};
  const k = Object.keys(cf).find((x) => cf[x] && cf[x].trim());
  if (k) return `${k}: ${cf[k]}`;
  if (c.notes && c.notes.trim()) {
    const p = c.notes.trim().replace(/\s+/g, ' ');
    return p.length > 50 ? p.slice(0, 50) + '…' : p;
  }
  return c.phone;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contentPad: { padding: 16, paddingTop: 56, paddingBottom: 80 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { padding: 16, paddingTop: 56, paddingBottom: 12 },
  backBtn: { alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 6 },
  backTxt: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '500' },
  stepIndicator: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  // ─── Step progress (4-segment tick bar, replaces "Step 1 of 4") ───
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  progressSeg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: TatvaColors.borderPrimary,
    alignItems: 'flex-end',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  progressSegDone: {
    backgroundColor: TatvaColors.brandPrimary,
    paddingRight: 3,
  },
  progressSegCurrent: {
    backgroundColor: TatvaColors.indigoContent,
  },
  title: { fontSize: 22, fontWeight: '500', color: COLORS.text, marginTop: 4 },
  hint: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 18 },

  searchRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  // Pill-shaped search wrap with leading icon. Sits in the searchRow next
  // to the "Manage" link.
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 44,
  },
  searchIcon: { fontSize: 14 },
  searchInputInner: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    paddingVertical: 0,
  },
  manageBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  manageBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: TatvaColors.indigoContent,
  },

  // Strong empty hero shown when the user has zero saved contacts.
  // Replaces the search input on this step so there's nothing to mistake
  // for a "type a name to add a contact" entry field.
  emptyHero: {
    flex: 1,
    margin: 16,
    padding: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyHeroTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  emptyHeroBody: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  emptyHeroCta: {
    backgroundColor: TatvaColors.brandPrimary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  emptyHeroCtaText: {
    color: TatvaColors.brandContentInverse,
    fontWeight: '600',
    fontSize: 15,
  },

  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    gap: 12,
  },
  contactCardPicked: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.text },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '500', color: COLORS.primary },
  contactName: { fontSize: 15, fontWeight: '500', color: COLORS.text },
  contactSub: { fontSize: 12.5, color: COLORS.textMuted, marginTop: 2 },

  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPicked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkMark: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '500' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.surface,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  footerSummary: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    minWidth: 160,
  },
  primaryBtnText: { color: COLORS.textOnInk, fontWeight: '500', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },

  emptyBlock: { padding: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '500', color: COLORS.text, marginBottom: 6 },
  emptyText: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },

  radio: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    marginBottom: 10,
    gap: 12,
    alignItems: 'flex-start',
  },
  radioActive: { borderColor: COLORS.text },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { borderColor: COLORS.text },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.text },
  radioTitle: { fontSize: 15, fontWeight: '500', color: COLORS.text, marginBottom: 2 },
  radioSub: { fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 17 },

  presetWrap: { paddingTop: 6 },
  presetLabel: { fontSize: 13, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  presetActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.text },
  presetText: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  presetTextActive: { color: COLORS.text },

  // Allowed-window block — sits below the schedule radios.
  windowBlock: {
    marginTop: 18,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    padding: 14,
  },
  windowLabelHi: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  windowLabelEn: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, marginBottom: 12 },
  timeRow: { flexDirection: 'row', gap: 10 },
  timeField: { flex: 1 },
  timeFieldLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  timeInput: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  timeInputInvalid: { borderColor: COLORS.danger },
  windowHint: { fontSize: 11, color: COLORS.textMuted, marginTop: 10 },
  windowError: { fontSize: 12, color: COLORS.danger, marginTop: 6 },

  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  kvRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  kvRemove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kvRemoveTxt: { fontSize: 18, color: COLORS.textSecondary, marginTop: -2 },
  linkTxt: { fontSize: 14, fontWeight: '500', color: COLORS.text, paddingVertical: 6 },

  summaryRow: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: { fontSize: 14, color: COLORS.text, lineHeight: 19 },

  costCard: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  costLine: { fontSize: 15, color: COLORS.text },
  costBig: { fontWeight: '500', fontSize: 16 },
  costSub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 6 },
  costBigSecondary: { fontWeight: '500', color: COLORS.text },

  // Bilingual stacked CTAs — match importer review styles exactly.
  cta: {
    flexDirection: 'row',
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaTextHi: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },
  ctaTextEn: {
    color: COLORS.textOnInk,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
    opacity: 0.7,
  },

  secondaryCta: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryCtaTextHi: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '500',
  },
  secondaryCtaTextEn: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '400',
    marginTop: 2,
    opacity: 0.85,
  },

  // Validate banner — same warm-hint pattern as the importer.
  validateBanner: {
    backgroundColor: COLORS.statusDeclinedBg,
    borderRadius: 8,
    padding: 14,
    marginTop: 18,
    gap: 10,
  },
  validateBannerText: {
    fontSize: 12,
    color: COLORS.statusDeclinedFg,
    lineHeight: 18,
  },
  validateRetryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  validateRetryText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.statusDeclinedFg,
    textDecorationLine: 'underline',
  },

  errorTxt: { fontSize: 14, color: COLORS.danger, textAlign: 'center', marginBottom: 16 },
});
