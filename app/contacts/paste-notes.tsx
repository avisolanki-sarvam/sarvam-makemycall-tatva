/**
 * /contacts/paste-notes
 *
 * Killer feature for kirana / gym / salon / tuition users — they keep
 * customer registers in WhatsApp, paper notes, or notes apps. This screen
 * lets them paste the whole register at once and we structure it.
 *
 * Flow:
 *   1. User pastes (or dictates → transcribes → pastes) free-form text
 *   2. Tap "Parse" → POST /onboarding/parse-notes
 *   3. We show the parsed rows with inline edit, plus skipped lines
 *      with reasons (so the user can fix and retry, or accept losses)
 *   4. User taps "Add N contacts" → POST /contacts/bulk
 *   5. Success → navigate back to contacts list
 *
 * Important: the parse step does NOT persist anything. Persistence
 * happens only on the explicit bulk-add tap. This lets the user review
 * + correct without committing partial data.
 */

import { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';
import { useContactStore } from '../../src/stores/contactStore';

type ParsedRow = {
  name: string | null;
  phone: string | null;
  variables: Record<string, string>;
};

type SkippedLine = {
  line: string;
  reason: string;
};

interface ParseResponse {
  rows: ParsedRow[];
  defaultVariables: Record<string, string>;
  detectedIntent: string;
  skipped: SkippedLine[];
}

interface BulkAddResponse {
  success: boolean;
  created: any[];
  createdCount: number;
  skippedCount: number;
  skipped: string[];
}

// Editable per-row state. We add a checkbox so the user can skip rows
// they don't actually want to import (e.g. parsed something garbage).
type EditableRow = {
  selected: boolean;
  name: string;
  phone: string;
  task: string;
};

export default function PasteNotesScreen() {
  const router = useRouter();
  const fetchContacts = useContactStore((s) => s.contacts && (() => {})); // we'll trigger refresh after bulk

  const [text, setText] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi' | 'hinglish'>('hinglish');
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [skipped, setSkipped] = useState<SkippedLine[]>([]);
  const [defaultVars, setDefaultVars] = useState<Record<string, string>>({});
  const [detectedIntent, setDetectedIntent] = useState<string | null>(null);

  const selectedCount = useMemo(() => rows.filter(r => r.selected).length, [rows]);
  const canParse = text.trim().length >= 5;
  const canSubmit = selectedCount > 0 && !submitting;

  const handleParse = async () => {
    if (!canParse) return;
    setParsing(true);
    try {
      const res = await api.post<ParseResponse>(
        '/onboarding/parse-notes',
        { text: text.trim(), language },
      );

      const editable: EditableRow[] = (res.rows || []).map((r) => ({
        selected: !!(r.name || r.phone),
        name: r.name || '',
        phone: r.phone || '',
        // The "task" we store is the most useful single freeform string from
        // the parsed variables. Falls back to a comma-join if there are
        // multiple. Per-contact-task ends up in `notes` on the bulk-create.
        task: variableSummary(r.variables, res.defaultVariables),
      }));

      setRows(editable);
      setSkipped(Array.isArray(res.skipped) ? res.skipped : []);
      setDefaultVars(res.defaultVariables || {});
      setDetectedIntent(res.detectedIntent || null);
    } catch (err: any) {
      Alert.alert(
        'Could not parse',
        err?.message || 'The server rejected the parse request. Try splitting the text into smaller chunks.',
      );
    } finally {
      setParsing(false);
    }
  };

  const handleAddContacts = async () => {
    const toAdd = rows.filter((r) => r.selected);
    if (toAdd.length === 0) return;

    // Validate: each row needs at least a phone OR (name + a task to indicate intent)
    const malformed = toAdd.filter((r) => !r.phone || r.phone.replace(/\D/g, '').length < 10);
    if (malformed.length > 0) {
      Alert.alert(
        'Some rows need a phone',
        `${malformed.length} row(s) don't have a valid 10-digit phone. Either fix them, untick them, or add the phones manually before continuing.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<BulkAddResponse>('/contacts/bulk', {
        contacts: toAdd.map((r) => ({
          name: r.name.trim() || 'Unknown',
          phone: r.phone.replace(/\D/g, ''),
          notes: r.task.trim() || null,
          customFields: r.task.trim() ? { task: r.task.trim() } : {},
        })),
      });

      // Refresh the contacts store and navigate back so the user sees the
      // newly-added rows immediately.
      try {
        const refreshed = await api.get<{ contacts: any[] }>('/contacts');
        useContactStore.getState().setContacts(refreshed.contacts || []);
      } catch (_) { /* non-fatal */ }

      Alert.alert(
        'Contacts added',
        `${res.createdCount} new ${res.createdCount === 1 ? 'contact' : 'contacts'}.` +
          (res.skippedCount > 0 ? `\n${res.skippedCount} skipped (already exist).` : ''),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('Failed to add contacts', err?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateRow = (idx: number, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Paste your notes</Text>
          <Text style={styles.subtitle}>
            Paste customer names, phone numbers, and what each call should be about. We'll
            structure them — review before adding.
          </Text>
        </View>

        {/* Input */}
        <Text style={styles.sectionLabel}>Your notes</Text>
        <TextInput
          style={styles.textarea}
          multiline
          placeholder={
            'Ramesh 9876543210 — pending payment 200\n' +
            'Sita 9988776655 - asked for monthly plan\n' +
            'baaki sab se 100'
          }
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={setText}
          textAlignVertical="top"
          editable={!parsing && !submitting}
        />

        {/* Language pills */}
        <Text style={styles.sectionLabelTight}>Notes in</Text>
        <View style={styles.langRow}>
          {(['hinglish', 'hi', 'en'] as const).map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[styles.langPill, language === lang && styles.langPillActive]}
              onPress={() => setLanguage(lang)}
              disabled={parsing || submitting}
            >
              <Text style={[styles.langPillText, language === lang && styles.langPillTextActive]}>
                {lang === 'hinglish' ? 'Hinglish' : lang === 'hi' ? 'हिंदी' : 'English'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Parse */}
        <TouchableOpacity
          style={[styles.cta, (!canParse || parsing) && styles.ctaDisabled]}
          onPress={handleParse}
          disabled={!canParse || parsing}
        >
          {parsing ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.ctaText}>{rows.length > 0 ? 'Re-parse' : 'Parse'}</Text>
          )}
        </TouchableOpacity>

        {/* Detected intent + default vars summary */}
        {detectedIntent ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>What we read</Text>
            <Text style={styles.summaryRow}>
              Intent: <Text style={styles.summaryStrong}>{intentLabel(detectedIntent)}</Text>
            </Text>
            {Object.keys(defaultVars).length > 0 ? (
              <Text style={styles.summaryRow}>
                Applied to all:{' '}
                <Text style={styles.summaryStrong}>
                  {Object.entries(defaultVars).map(([k, v]) => `${k} = ${v}`).join(', ')}
                </Text>
              </Text>
            ) : null}
            <Text style={styles.summaryRow}>
              Found <Text style={styles.summaryStrong}>{rows.length}</Text> contact{rows.length === 1 ? '' : 's'},
              skipped <Text style={styles.summaryStrong}>{skipped.length}</Text> line{skipped.length === 1 ? '' : 's'}.
            </Text>
          </View>
        ) : null}

        {/* Editable rows */}
        {rows.length > 0 ? (
          <View style={{ marginTop: 4 }}>
            <View style={styles.rowsHeader}>
              <Text style={styles.sectionLabel}>Review &amp; edit</Text>
              <Text style={styles.rowsCount}>{selectedCount} selected</Text>
            </View>
            {rows.map((r, idx) => (
              <View key={idx} style={[styles.row, !r.selected && styles.rowDim]}>
                <TouchableOpacity
                  style={[styles.checkbox, r.selected && styles.checkboxOn]}
                  onPress={() => updateRow(idx, { selected: !r.selected })}
                  hitSlop={10}
                >
                  {r.selected ? <Text style={styles.checkmark}>✓</Text> : null}
                </TouchableOpacity>
                <View style={styles.rowFields}>
                  <TextInput
                    style={styles.rowInput}
                    placeholder="Name"
                    placeholderTextColor={COLORS.textMuted}
                    value={r.name}
                    onChangeText={(v) => updateRow(idx, { name: v })}
                    editable={!submitting}
                  />
                  <TextInput
                    style={styles.rowInput}
                    placeholder="Phone (10 digits)"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="phone-pad"
                    value={r.phone}
                    onChangeText={(v) => updateRow(idx, { phone: v })}
                    editable={!submitting}
                  />
                  <TextInput
                    style={[styles.rowInput, styles.rowInputTask]}
                    placeholder="What's this call about?"
                    placeholderTextColor={COLORS.textMuted}
                    value={r.task}
                    onChangeText={(v) => updateRow(idx, { task: v })}
                    editable={!submitting}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Skipped lines */}
        {skipped.length > 0 ? (
          <View style={styles.skippedCard}>
            <Text style={styles.skippedLabel}>
              Couldn't parse {skipped.length} line{skipped.length === 1 ? '' : 's'}
            </Text>
            {skipped.map((s, i) => (
              <Text key={i} style={styles.skippedLine}>
                <Text style={styles.skippedReason}>{s.reason}:</Text> {s.line}
              </Text>
            ))}
            <Text style={styles.skippedHint}>
              Tip: edit your notes above and tap Re-parse, or add these contacts manually later.
            </Text>
          </View>
        ) : null}

        {/* Submit */}
        {rows.length > 0 ? (
          <TouchableOpacity
            style={[styles.submit, !canSubmit && styles.ctaDisabled]}
            onPress={handleAddContacts}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.textOnInk} />
            ) : (
              <Text style={styles.ctaText}>
                Add {selectedCount} {selectedCount === 1 ? 'contact' : 'contacts'}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Synthesize a single freeform "task" string from a row's variables +
// defaults. e.g. {amount:"200"} + {amount:"100" default} → "amount: 200".
function variableSummary(
  rowVars: Record<string, string>,
  defaultVars: Record<string, string>,
): string {
  const merged = { ...defaultVars, ...(rowVars || {}) };
  const entries = Object.entries(merged).filter(([, v]) => v && String(v).trim());
  if (entries.length === 0) return '';
  if (entries.length === 1) return `${entries[0][0]}: ${entries[0][1]}`;
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

function intentLabel(intent: string): string {
  switch (intent) {
    case 'collections': return 'Pending payments';
    case 'sales':       return 'Sales / outreach';
    case 'reminder':    return 'Reminder calls';
    case 'survey':      return 'Feedback / survey';
    default:            return 'General outreach';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 24, paddingTop: 60, paddingBottom: 48 },

  header: { marginBottom: 20 },
  back: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 12, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, lineHeight: 34 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, lineHeight: 20 },

  sectionLabel: {
    fontSize: 12, fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: 14, marginBottom: 8,
  },
  sectionLabelTight: {
    fontSize: 12, fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: 16, marginBottom: 8,
  },

  textarea: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.text,
    minHeight: 160, textAlignVertical: 'top',
    lineHeight: 22,
  },

  langRow: { flexDirection: 'row', gap: 8 },
  langPill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  langPillActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  langPillText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  langPillTextActive: { color: COLORS.primary },

  cta: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: COLORS.textOnInk, fontSize: 16, fontWeight: '700' },

  summaryCard: {
    backgroundColor: COLORS.statusMuteBg,
    borderRadius: 12,
    padding: 14,
    marginTop: 18,
    gap: 4,
  },
  summaryLabel: {
    fontSize: 11, fontWeight: '700',
    color: COLORS.statusMuteFg,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryRow: { fontSize: 13, color: COLORS.text, lineHeight: 19 },
  summaryStrong: { fontWeight: '700', color: COLORS.text },

  rowsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
  },
  rowsCount: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  rowDim: { opacity: 0.55 },
  checkbox: {
    width: 22, height: 22,
    borderRadius: 6,
    borderWidth: 2, borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  checkboxOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  checkmark: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '700', lineHeight: 14 },

  rowFields: { flex: 1, gap: 6 },
  rowInput: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: COLORS.text,
    borderWidth: 1, borderColor: 'transparent',
  },
  rowInputTask: { fontSize: 13, color: COLORS.textSecondary },

  skippedCard: {
    backgroundColor: '#fef9c3',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1, borderColor: '#fde68a',
    gap: 4,
  },
  skippedLabel: {
    fontSize: 12, fontWeight: '700',
    color: '#854d0e',
    marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  skippedLine: { fontSize: 13, color: '#713f12', lineHeight: 19 },
  skippedReason: { fontWeight: '700' },
  skippedHint: { fontSize: 12, color: '#713f12', marginTop: 6, lineHeight: 16, fontStyle: 'italic' },

  submit: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 22,
  },
});
