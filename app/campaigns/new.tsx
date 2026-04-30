import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/constants/api';
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
      const a = agentsRes?.agents?.[0];
      if (a) {
        setAgentId(a.id);
        setAgentName(a.name);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load. Pull to refresh.');
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
          setValidateError(env.hint || raw?.errors?.[0]?.hint || 'Agent is not ready.');
          setValidateErrorCode(raw?.errors?.[0]?.code || null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setValid(false);
        setValidateError(err?.message || 'Could not check agent status.');
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
      Alert.alert('No assistant', 'Set up your AI assistant before launching a campaign.');
      return;
    }
    if (draft.selectedContactIds.length === 0) {
      Alert.alert('No one to call', 'Pick at least one contact.');
      return;
    }
    if (valid !== true) {
      // Defensive — the CTA should already be disabled in this case.
      Alert.alert('Assistant not ready', validateError || 'Please try again in a moment.');
      return;
    }
    const cost = draft.selectedContactIds.length;
    if (creditBalance < cost) {
      Alert.alert(
        'Need more credits',
        `This campaign costs ${cost} credits. You have ${creditBalance}.`,
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
      Alert.alert('Could not launch', env.hint || 'Try again.');
    } catch (e: any) {
      Alert.alert('Could not launch', e?.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------ UI bits

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <TouchableOpacity onPress={goPrev} hitSlop={12} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.stepIndicator}>
        Step {stepIndex + 1} of {STEP_ORDER.length}
      </Text>
      <Text style={styles.title}>{title}</Text>
    </View>
  );

  // ------------------------------------------------------------------ Contacts step

  const filtered = getFilteredContacts();

  const renderContactsStep = () => (
    <>
      {renderHeader('Who should I call?')}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or number"
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>
      {filtered.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyTitle}>No contacts yet</Text>
          <Text style={styles.emptyText}>
            Add contacts on the Contacts tab first.
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
      <View style={styles.footer}>
        <Text style={styles.footerSummary}>
          {draft.selectedContactIds.length > 0
            ? `${draft.selectedContactIds.length} selected`
            : 'Pick at least one contact'}
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, draft.selectedContactIds.length === 0 && styles.btnDisabled]}
          disabled={draft.selectedContactIds.length === 0}
          onPress={goNext}
        >
          <Text style={styles.primaryBtnText}>Next — schedule</Text>
        </TouchableOpacity>
      </View>
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
      {renderHeader('When should I call?')}

      <RadioRow
        active={draft.scheduleMode === 'now'}
        title="Call now"
        subtitle="Start as soon as I tap Launch"
        onPress={() => {
          draft.setScheduleMode('now');
          draft.setScheduledAt(null);
        }}
      />
      <RadioRow
        active={draft.scheduleMode === 'later'}
        title="Schedule for later"
        subtitle="Pick a start time"
        onPress={() => draft.setScheduleMode('later')}
      />

      {draft.scheduleMode === 'later' && (
        <View style={styles.presetWrap}>
          <Text style={styles.presetLabel}>Pick a time:</Text>
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
        <Text style={styles.windowLabelHi}>Call timing window</Text>
        <Text style={styles.windowLabelEn}>Calls go out only between these times</Text>
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.timeFieldLabel}>From / Se</Text>
            <TextInput
              style={[
                styles.timeInput,
                !normalizedStart && styles.timeInputInvalid,
              ]}
              value={startTimeText}
              onChangeText={setStartTimeText}
              onBlur={commitStartTime}
              placeholder="11:00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoCorrect={false}
            />
          </View>
          <View style={styles.timeField}>
            <Text style={styles.timeFieldLabel}>To / Tak</Text>
            <TextInput
              style={[
                styles.timeInput,
                !normalizedEnd && styles.timeInputInvalid,
              ]}
              value={endTimeText}
              onChangeText={setEndTimeText}
              onBlur={commitEndTime}
              placeholder="19:00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoCorrect={false}
            />
          </View>
        </View>
        <Text style={styles.windowHint}>
          Type the hour like 8 or 08 — we'll normalise to HH:MM. Timezone: Asia/Kolkata.
        </Text>
        {normalizedStart &&
          normalizedEnd &&
          normalizedStart >= normalizedEnd && (
            <Text style={styles.windowError}>End time must be after start time.</Text>
          )}
      </View>

      <View style={[styles.footer, { marginTop: 24 }]}>
        <View />
        <TouchableOpacity
          style={[styles.primaryBtn, !scheduleStepReady && styles.btnDisabled]}
          disabled={!scheduleStepReady}
          onPress={goNext}
        >
          <Text style={styles.primaryBtnText}>Next — variables</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ------------------------------------------------------------------ Variables step

  const renderVariablesStep = () => (
    <ScrollView contentContainerStyle={styles.contentPad}>
      {renderHeader('Anything to share with all of them?')}
      <Text style={styles.hint}>
        Optional. These are values used the same way for everyone in this campaign — like a
        common deadline or location. Per-contact details (their pending amount, last visit,
        etc.) are picked up from the contact's saved info automatically.
      </Text>

      {varRows.map((row, i) => (
        <View key={i} style={styles.kvRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Field"
            placeholderTextColor={COLORS.textMuted}
            value={row.key}
            onChangeText={(t) =>
              setVarRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, key: t } : r)))
            }
          />
          <TextInput
            style={[styles.input, { flex: 1.4 }]}
            placeholder="Value"
            placeholderTextColor={COLORS.textMuted}
            value={row.value}
            onChangeText={(t) =>
              setVarRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, value: t } : r)))
            }
          />
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
        <Text style={styles.linkTxt}>+ Add another field</Text>
      </TouchableOpacity>

      <View style={[styles.footer, { marginTop: 24 }]}>
        <TouchableOpacity onPress={goNext}>
          <Text style={styles.linkTxt}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={goNext}>
          <Text style={styles.primaryBtnText}>Next — review</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ------------------------------------------------------------------ Review step

  const formatAllowedWindow = (w: AllowedWindow): string => {
    const days =
      w.days.length === 7
        ? 'Every day'
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
        ? 'Now'
        : draft.scheduledAt
          ? new Date(draft.scheduledAt).toLocaleString()
          : 'Later (no time picked)';

    const launchDisabled =
      submitting ||
      validating ||
      valid !== true ||
      balanceAfter < 0 ||
      draft.selectedContactIds.length === 0;

    return (
      <ScrollView contentContainerStyle={styles.contentPad}>
        {renderHeader('Ready to call?')}

        <SummaryRow label="AI assistant" value={agentName || '—'} />
        <SummaryRow label="When" value={scheduleLabel} />
        <SummaryRow label="Call window" value={formatAllowedWindow(draft.allowedWindow)} />
        <SummaryRow
          label="Who"
          value={`${selected.length} contact${selected.length === 1 ? '' : 's'}: ${selected.slice(0, 3).join(', ')}${selected.length > 3 ? `, +${selected.length - 3} more` : ''}`}
        />
        {Object.keys(vars).length > 0 && (
          <SummaryRow
            label="Shared details"
            value={Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('  •  ')}
          />
        )}

        <View style={styles.costCard}>
          <Text style={styles.costLine}>
            {cost} call{cost === 1 ? '' : 's'} × 1 credit = <Text style={styles.costBig}>{cost}</Text> credit{cost === 1 ? '' : 's'}
          </Text>
          <Text style={styles.costSub}>
            Balance after: <Text style={styles.costBigSecondary}>{balanceAfter}</Text>
            {balanceAfter < 0 ? '  •  Need more credits' : ''}
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
                {showRecreate ? 'Re-create' : 'Try again'}
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
              <Text style={styles.ctaTextHi}>Checking…</Text>
              <Text style={styles.ctaTextEn}>Verifying agent</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.ctaTextHi}>Launch karein</Text>
              <Text style={styles.ctaTextEn}>Launch campaign</Text>
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
            <Text style={styles.secondaryCtaTextHi}>Badlein</Text>
            <Text style={styles.secondaryCtaTextEn}>Edit</Text>
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
          <Text style={styles.primaryBtnText}>Retry</Text>
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
  title: { fontSize: 22, fontWeight: '500', color: COLORS.text, marginTop: 4 },
  hint: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 18 },

  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
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
