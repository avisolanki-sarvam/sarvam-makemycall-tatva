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
import { api } from '../../src/services/api';
import { useContactStore, type Contact } from '../../src/stores/contactStore';
import {
  useCampaignDraftStore,
  type ScheduleMode,
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

// Server constrains schedule to 09:00–20:00 IST mon–sat. We don't
// reimplement the timezone math on the client — instead we offer a small
// set of chips that fall safely inside the window, plus rely on the 400
// from POST /campaigns if anything slips through.
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

  // Reset draft + load supporting data on first mount.
  useEffect(() => {
    draft.reset();
    setSearchQuery('');
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const launch = async () => {
    if (!agentId) {
      Alert.alert('No assistant', 'Set up your AI assistant before launching a campaign.');
      return;
    }
    if (draft.selectedContactIds.length === 0) {
      Alert.alert('No one to call', 'Pick at least one contact.');
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
      const payload: Record<string, any> = {
        agentId,
        contactIds: draft.selectedContactIds,
        variables: buildVarsObject(),
      };
      if (draft.scheduleMode === 'later' && draft.scheduledAt) {
        payload.scheduledAt = draft.scheduledAt;
      }
      const res = await api.post<{ campaign: { id: string } }>('/campaigns', payload);
      draft.reset();
      router.replace(`/campaigns/${res.campaign.id}`);
    } catch (e: any) {
      // 402 from server lands here. The api wrapper turns the body into
      // .message via extractError; for the structured payload we still get
      // a useful string.
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
        subtitle="Pick a time within calling hours (09:00–20:00 IST, Mon–Sat)"
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

      <View style={[styles.footer, { marginTop: 24 }]}>
        <View />
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            draft.scheduleMode === 'later' && !draft.scheduledAt && styles.btnDisabled,
          ]}
          disabled={draft.scheduleMode === 'later' && !draft.scheduledAt}
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

    return (
      <ScrollView contentContainerStyle={styles.contentPad}>
        {renderHeader('Ready to call?')}

        <SummaryRow label="AI assistant" value={agentName || '—'} />
        <SummaryRow label="When" value={scheduleLabel} />
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

        <TouchableOpacity
          style={[styles.primaryBtn, (submitting || balanceAfter < 0) && styles.btnDisabled]}
          disabled={submitting || balanceAfter < 0}
          onPress={launch}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.primaryBtnText}>Launch calls</Text>
          )}
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
  backTxt: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600' },
  stepIndicator: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  title: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  hint: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 18 },

  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
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
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
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
  avatarText: { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  contactName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  contactSub: { fontSize: 12.5, color: COLORS.textMuted, marginTop: 2 },

  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPicked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkMark: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '800' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerSummary: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    minWidth: 160,
  },
  primaryBtnText: { color: COLORS.textOnInk, fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },

  emptyBlock: { padding: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  emptyText: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },

  radio: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
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
    borderWidth: 2,
    borderColor: COLORS.border,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { borderColor: COLORS.text },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.text },
  radioTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  radioSub: { fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 17 },

  presetWrap: { paddingTop: 6 },
  presetLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  presetActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.text },
  presetText: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  presetTextActive: { color: COLORS.text },

  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
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
  linkTxt: { fontSize: 14, fontWeight: '600', color: COLORS.text, paddingVertical: 6 },

  summaryRow: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: { fontSize: 14, color: COLORS.text, lineHeight: 19 },

  costCard: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 14,
    padding: 16,
    marginVertical: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  costLine: { fontSize: 15, color: COLORS.text },
  costBig: { fontWeight: '800', fontSize: 16 },
  costSub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 6 },
  costBigSecondary: { fontWeight: '700', color: COLORS.text },

  errorTxt: { fontSize: 14, color: COLORS.danger, textAlign: 'center', marginBottom: 16 },
});
