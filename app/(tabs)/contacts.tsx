import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ClipboardTextIcon, DeviceMobileIcon } from 'phosphor-react-native';
import { useContactStore, type Contact } from '../../src/stores/contactStore';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';
import { loadDeviceContacts, type DeviceContact } from '../../src/services/contactImport';
import { TatvaIcon } from '../../src/components/TatvaIcon';

// 4 add modes surfaced as prominent buttons at the top of the Contacts
// tab. Each routes to /contacts/import with the matching mode pre-selected.
// /contacts/import is now agent-optional — entered from here without an
// agentId, it runs in save-only mode (no campaign launch).
//
// Order matters: "Screenshot" is first because the killer use case for
// our SMB audience is photographing or screenshotting an existing
// contact list (WhatsApp group, register page) — Sarvam Vision OCR
// turns it into structured contacts in one step.
const ADD_MODES: Array<{
  mode: 'paste' | 'photo' | 'voice' | 'contacts';
  labelKey: string;
  icon: 'upload' | 'phone' | 'paste' | 'microphone';
}> = [
  { mode: 'photo', labelKey: 'contacts.addModes.photo', icon: 'upload' },
  { mode: 'contacts', labelKey: 'contacts.addModes.fromPhone', icon: 'phone' },
  { mode: 'paste', labelKey: 'contacts.addModes.paste', icon: 'paste' },
  { mode: 'voice', labelKey: 'contacts.addModes.voice', icon: 'microphone' },
];

// Starter-key suggestions. Free-form: tapping a chip just pre-fills the key,
// the user types whatever value they want. Not industry-detected (yet) — these
// cover the most common SMB call types per Avi's chat decision.
const SUGGESTED_KEYS = [
  'pending',
  'due date',
  'last paid',
  'visit',
  'order',
];

type KVRow = { key: string; value: string };

const newRow = (): KVRow => ({ key: '', value: '' });

// Subtitle shown on each contact row: first non-empty custom field → notes
// preview (first ~40 chars) → phone. Per the "Custom fields" plan in the
// status board.
function subtitleFor(c: Contact): string {
  const cf = c.customFields || {};
  const firstKey = Object.keys(cf).find((k) => cf[k] && cf[k].trim());
  if (firstKey) return `${firstKey}: ${cf[firstKey]}`;
  if (c.notes && c.notes.trim()) {
    const preview = c.notes.trim().replace(/\s+/g, ' ');
    return preview.length > 50 ? preview.slice(0, 50) + '…' : preview;
  }
  return c.phone;
}

export default function ContactsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    contacts,
    searchQuery,
    isLoading,
    setContacts,
    setSearchQuery,
    setLoading,
    getFilteredContacts,
  } = useContactStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [kvRows, setKvRows] = useState<KVRow[]>([newRow()]);

  // Phone-book import state
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
  const [importSearch, setImportSearch] = useState('');

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ contacts: Contact[] }>('/contacts');
      setContacts(data?.contacts || []);
    } catch {
      // Backend route not built yet (or transient) — keep what we have.
      setContacts([]);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setNewName('');
    setNewPhone('');
    setNewNotes('');
    setKvRows([newRow()]);
    setShowAddForm(false);
  };

  const updateKvKey = (i: number, key: string) =>
    setKvRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, key } : r)));
  const updateKvValue = (i: number, value: string) =>
    setKvRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, value } : r)));
  const addKvRow = () => setKvRows((rs) => [...rs, newRow()]);
  const removeKvRow = (i: number) =>
    setKvRows((rs) => (rs.length === 1 ? [newRow()] : rs.filter((_, idx) => idx !== i)));

  const applySuggestion = (key: string) => {
    // Drop into the first empty key slot, otherwise append a new row.
    const emptyIdx = kvRows.findIndex((r) => !r.key.trim());
    if (emptyIdx >= 0) {
      updateKvKey(emptyIdx, key);
    } else {
      setKvRows((rs) => [...rs, { key, value: '' }]);
    }
  };

  const buildCustomFields = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of kvRows) {
      const k = r.key.trim();
      const v = r.value.trim();
      if (k && v) out[k] = v;
    }
    return out;
  };

  const handleAddContact = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      Alert.alert(t('contacts.alerts.requiredTitle'), t('contacts.alerts.requiredBody'));
      return;
    }
    const customFields = buildCustomFields();
    const payload: Record<string, any> = {
      name: newName.trim(),
      phone: newPhone.replace(/\D/g, ''),
    };
    if (newNotes.trim()) payload.notes = newNotes.trim();
    if (Object.keys(customFields).length > 0) payload.customFields = customFields;

    try {
      const data = await api.post<{ contact: Contact }>('/contacts', payload);
      if (data?.contact) {
        setContacts([...contacts, data.contact]);
      }
      resetForm();
    } catch (err: any) {
      // Backend not reachable — fall back to local-only so the UI still feels alive.
      const localContact: Contact = {
        id: Date.now().toString(),
        name: payload.name,
        phone: payload.phone,
        notes: payload.notes,
        customFields,
      };
      setContacts([...contacts, localContact]);
      resetForm();
    }
  };

  const filtered = getFilteredContacts();

  // ---- Phone-book import handlers ----
  const openImport = async () => {
    setImportOpen(true);
    setImportSelected(new Set());
    setImportSearch('');
    setImportLoading(true);
    try {
      const res = await loadDeviceContacts();
      if (!res.ok) {
        setImportOpen(false);
        Alert.alert(
          res.reason === 'denied' ? t('contacts.alerts.permissionDeniedTitle') : t('contacts.alerts.phoneBookUnavailableTitle'),
          res.message,
        );
        return;
      }
      // Hide phones the user already has — /contacts/bulk would skip them anyway,
      // but it's clearer if the picker only shows new candidates.
      const existingPhones = new Set(contacts.map((c) => c.phone));
      const fresh = res.contacts.filter((dc) => !existingPhones.has(dc.phone));
      setDeviceContacts(fresh);
    } catch (err: any) {
      setImportOpen(false);
      Alert.alert(t('contacts.alerts.couldNotLoadTitle'), err?.message || t('common.tryAgain'));
    } finally {
      setImportLoading(false);
    }
  };

  const toggleImportPick = (id: string) =>
    setImportSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filteredDeviceContacts = useMemo(() => {
    const q = importSearch.trim().toLowerCase();
    if (!q) return deviceContacts;
    return deviceContacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [deviceContacts, importSearch]);

  const submitImport = async () => {
    const picks = deviceContacts.filter((c) => importSelected.has(c.id));
    if (picks.length === 0) {
      Alert.alert(t('contacts.alerts.pickAtLeastOneTitle'), t('contacts.alerts.pickAtLeastOneBody'));
      return;
    }
    setImportSubmitting(true);
    try {
      const res = await api.post<{
        created: Contact[];
        createdCount: number;
        skippedCount: number;
      }>('/contacts/bulk', {
        contacts: picks.map((p) => ({ name: p.name, phone: p.phone })),
      });
      // Merge created into store; bulk endpoint already deduped.
      if (res?.created?.length) {
        setContacts([...contacts, ...res.created]);
      }
      setImportOpen(false);
      const addedCount = res?.createdCount ?? picks.length;
      Alert.alert(
        t('contacts.alerts.importCompleteTitle'),
        t('contacts.alerts.importCompleteBody', { count: addedCount }) +
          (res?.skippedCount ? `, skipped ${res.skippedCount} duplicate(s)` : ''),
      );
    } catch (err: any) {
      Alert.alert(t('contacts.alerts.importFailedTitle'), err?.message || t('common.tryAgain'));
    } finally {
      setImportSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Add-mode header — 4 prominent buttons for the four input modes
          (Paste / Photo / Voice / From phone). Each deep-links into
          /contacts/import with the chosen mode pre-selected. /contacts/import
          runs in save-only mode (no campaign) when entered without
          agentId. The cryptic icon-buttons that used to sit in the
          search row are gone — these explicit, labelled tiles are
          discoverable at a glance. */}
      <View style={styles.addModeSection}>
        <Text style={styles.addModeSectionLabel}>{t('contacts.addTitle')}</Text>
        <View style={styles.addModeRow}>
          {ADD_MODES.map((m) => {
            const label = t(m.labelKey);
            return (
              <TouchableOpacity
                key={m.mode}
                style={styles.addModeTile}
                onPress={() => router.push(`/contacts/import?mode=${m.mode}`)}
                accessibilityRole="button"
                accessibilityLabel={t('contacts.modeA11y', { mode: label })}
              >
                <View style={styles.addModeIcon}>
                  <AddModeIcon name={m.icon} />
                </View>
                <Text style={styles.addModeLabel}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Search bar + manual-add quick action. The phone-book and
          paste-notes shortcuts were promoted into the Add contacts row
          above — only the manual "+" remains here for users who want to
          type a single contact in place. */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('contacts.searchPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => (showAddForm ? resetForm() : setShowAddForm(true))}
          accessibilityLabel={showAddForm ? t('contacts.closeManualA11y') : t('contacts.openManualA11y')}
        >
          <Text style={styles.addBtnText}>{showAddForm ? '✕' : '+'}</Text>
        </TouchableOpacity>
      </View>

      {/* Add Contact Form */}
      {showAddForm && (
        <ScrollView style={styles.addForm} contentContainerStyle={styles.addFormInner}>
          <TextInput
            style={styles.formInput}
            placeholder={t('contacts.namePlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={styles.formInput}
            placeholder={t('contacts.phonePlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            value={newPhone}
            onChangeText={setNewPhone}
            keyboardType="phone-pad"
          />

          {/* Custom fields — free-form key/value rows */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('contacts.anythingHeading')}</Text>
            <Text style={styles.sectionHint}>
              {t('contacts.anythingHint')}
            </Text>

            {/* Suggestion chips */}
            <View style={styles.chipRow}>
              {SUGGESTED_KEYS.map((k) => (
                <TouchableOpacity key={k} style={styles.chip} onPress={() => applySuggestion(k)}>
                  <Text style={styles.chipText}>+ {k}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {kvRows.map((row, i) => (
              <View key={i} style={styles.kvRow}>
                <TextInput
                  style={[styles.formInput, styles.kvKey]}
                  placeholder={t('contacts.fieldKeyPlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  value={row.key}
                  onChangeText={(text) => updateKvKey(i, text)}
                />
                <TextInput
                  style={[styles.formInput, styles.kvValue]}
                  placeholder={t('contacts.fieldValuePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  value={row.value}
                  onChangeText={(text) => updateKvValue(i, text)}
                />
                <TouchableOpacity style={styles.kvRemove} onPress={() => removeKvRow(i)}>
                  <Text style={styles.kvRemoveText}>−</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity style={styles.addRowBtn} onPress={addKvRow}>
              <Text style={styles.addRowBtnText}>{t('contacts.addMoreFields')}</Text>
            </TouchableOpacity>
          </View>

          {/* Notes blob */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('contacts.notesLabel')}</Text>
            <Text style={styles.sectionHint}>
              {t('contacts.notesHint')}
            </Text>
            <TextInput
              style={[styles.formInput, styles.notesInput]}
              placeholder={t('contacts.notesPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={newNotes}
              onChangeText={setNewNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleAddContact}>
            <Text style={styles.saveBtnText}>{t('contacts.saveContact')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Contact List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{t('contacts.emptyTitle')}</Text>
          <Text style={styles.emptySubtext}>
            {t('contacts.emptyBody')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            // The row is now tappable end-to-end → opens the edit screen.
            // The trailing pencil icon makes the affordance visible without
            // forcing the user to "discover" the tap target.
            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.contactCard}
              onPress={() => router.push(`/contacts/${item.id}/edit`)}
              accessibilityRole="button"
              accessibilityLabel={t('contacts.editA11y', { name: item.name })}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.contactPhone} numberOfLines={1}>
                  {subtitleFor(item)}
                </Text>
              </View>
              <View style={styles.contactEditIcon} hitSlop={6 as any}>
                <TatvaIcon name="edit" size="sm" tone="secondary" />
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Phone-book import modal */}
      <Modal
        visible={importOpen}
        animationType="slide"
        onRequestClose={() => setImportOpen(false)}
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setImportOpen(false)} hitSlop={10}>
              <Text style={styles.modalClose}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('contacts.import.headerTitle')}</Text>
            <Text style={styles.modalCount}>
              {importSelected.size > 0 ? t('contacts.import.pickedCount', { count: importSelected.size }) : ' '}
            </Text>
          </View>

          {importLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.emptySubtext}>{t('contacts.import.loading')}</Text>
            </View>
          ) : (
            <>
              <View style={[styles.searchRow, { paddingTop: 6 }]}>
                <TextInput
                  style={styles.searchInput}
                  placeholder={t('contacts.import.search')}
                  placeholderTextColor={COLORS.textMuted}
                  value={importSearch}
                  onChangeText={setImportSearch}
                />
              </View>

              {filteredDeviceContacts.length === 0 ? (
                <View style={styles.center}>
                  <Text style={styles.emptyTitle}>{t('contacts.import.nothingNewTitle')}</Text>
                  <Text style={styles.emptySubtext}>
                    {t('contacts.import.nothingNewBody')}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filteredDeviceContacts}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.list}
                  renderItem={({ item }) => {
                    const picked = importSelected.has(item.id);
                    return (
                      <TouchableOpacity
                        style={[styles.contactCard, picked && styles.contactCardPicked]}
                        onPress={() => toggleImportPick(item.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {item.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.contactInfo}>
                          <Text style={styles.contactName}>{item.name}</Text>
                          <Text style={styles.contactPhone}>{item.phone}</Text>
                        </View>
                        <View style={[styles.check, picked && styles.checkPicked]}>
                          {picked && <Text style={styles.checkMark}>✓</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.saveBtn, importSelected.size === 0 && styles.saveBtnDisabled]}
                  onPress={submitImport}
                  disabled={importSubmitting || importSelected.size === 0}
                >
                  {importSubmitting ? (
                    <ActivityIndicator color={COLORS.textOnInk} />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {importSelected.size > 0
                        ? t('contacts.import.importCount', { count: importSelected.size })
                        : t('contacts.import.pickToImport')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

function AddModeIcon({ name }: { name: (typeof ADD_MODES)[number]['icon'] }) {
  if (name === 'upload') {
    return <TatvaIcon name="upload" size="lg" tone="brand" />;
  }
  if (name === 'microphone') {
    return <TatvaIcon name="microphone" size="lg" tone="brand" />;
  }
  if (name === 'phone') {
    return <DeviceMobileIcon size={20} color={COLORS.ink} weight="regular" />;
  }
  return <ClipboardTextIcon size={20} color={COLORS.ink} weight="regular" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // Add-mode header — 4-tile row at the top of the Contacts tab.
  addModeSection: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  addModeSectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addModeTile: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 7,
  },
  addModeIcon: {
    width: 36,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addModeLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.text,
  },

  searchRow: { flexDirection: 'row', padding: 12, gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
  },
  addBtn: {
    width: 42,
    height: 42,
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: COLORS.textOnInk, fontSize: 20, fontWeight: '500' },

  iconBtn: {
    width: 42,
    height: 42,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { color: COLORS.text, fontSize: 20, fontWeight: '500', marginTop: -2 },

  addForm: {
    margin: 12,
    marginTop: 0,
    maxHeight: 460,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
  },
  addFormInner: {
    padding: 14,
    gap: 10,
  },
  formInput: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
  },

  section: { gap: 8, paddingTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '500', color: COLORS.textMuted },
  sectionHint: { fontSize: 12, color: COLORS.textMuted, marginTop: -4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chipText: { fontSize: 11, color: COLORS.ink, fontWeight: '500' },

  kvRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kvKey: { flex: 1 },
  kvValue: { flex: 1.4 },
  kvRemove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kvRemoveText: { fontSize: 18, color: COLORS.textSecondary, marginTop: -2 },

  addRowBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  addRowBtnText: { fontSize: 13, fontWeight: '500', color: COLORS.text },

  notesInput: { minHeight: 70, paddingTop: 10 },

  saveBtn: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: COLORS.textOnInk, fontWeight: '500', fontSize: 13 },

  list: { padding: 12, paddingTop: 0 },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    gap: 12,
  },
  // Trailing pencil icon — visual cue that the row is tappable to edit.
  contactEditIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '500', color: COLORS.ink },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  contactPhone: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: COLORS.text, marginBottom: 6 },
  emptySubtext: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },

  // ---- Phone-book import modal ----
  modalContainer: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56, // safe area-ish for now; replace with insets if a header lib is added
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderSoft,
    backgroundColor: COLORS.surface,
  },
  modalTitle: { fontSize: 14, fontWeight: '500', color: COLORS.text, flex: 1, textAlign: 'center' },
  modalClose: { fontSize: 13, color: COLORS.textSecondary, width: 60 },
  modalCount: { fontSize: 12, color: COLORS.textMuted, width: 60, textAlign: 'right' },

  contactCardPicked: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.ink,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPicked: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  checkMark: { color: COLORS.textOnInk, fontSize: 13, fontWeight: '500' },

  modalFooter: {
    padding: 12,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.borderSoft,
    backgroundColor: COLORS.surface,
  },
  saveBtnDisabled: { opacity: 0.4 },
});
