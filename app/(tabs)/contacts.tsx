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
import { useContactStore, type Contact } from '../../src/stores/contactStore';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/api';
import { loadDeviceContacts, type DeviceContact } from '../../src/services/contactImport';

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
      Alert.alert('Required', 'Name and phone number are required.');
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
          res.reason === 'denied' ? 'Permission needed' : 'Phone book unavailable',
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
      Alert.alert('Could not load contacts', err?.message || 'Try again.');
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
      Alert.alert('Pick at least one', 'Tap the contacts you want to import.');
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
      Alert.alert(
        'Import complete',
        `Added ${res?.createdCount ?? picks.length}` +
          (res?.skippedCount ? `, skipped ${res.skippedCount} duplicate(s)` : ''),
      );
    } catch (err: any) {
      Alert.alert('Import failed', err?.message || 'Try again.');
    } finally {
      setImportSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts..."
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={openImport}
          accessibilityLabel="Import from phone"
        >
          <Text style={styles.iconBtnText}>↓</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.push('/contacts/paste-notes')}
          accessibilityLabel="Paste notes from register"
        >
          <Text style={styles.iconBtnText}>≡</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => (showAddForm ? resetForm() : setShowAddForm(true))}
        >
          <Text style={styles.addBtnText}>{showAddForm ? '✕' : '+'}</Text>
        </TouchableOpacity>
      </View>

      {/* Add Contact Form */}
      {showAddForm && (
        <ScrollView style={styles.addForm} contentContainerStyle={styles.addFormInner}>
          <TextInput
            style={styles.formInput}
            placeholder="Name"
            placeholderTextColor={COLORS.textMuted}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={styles.formInput}
            placeholder="Phone number"
            placeholderTextColor={COLORS.textMuted}
            value={newPhone}
            onChangeText={setNewPhone}
            keyboardType="phone-pad"
          />

          {/* Custom fields — free-form key/value rows */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Anything I should know?</Text>
            <Text style={styles.sectionHint}>
              e.g. pending amount, due date — or skip and use notes below.
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
                  placeholder="Field"
                  placeholderTextColor={COLORS.textMuted}
                  value={row.key}
                  onChangeText={(t) => updateKvKey(i, t)}
                />
                <TextInput
                  style={[styles.formInput, styles.kvValue]}
                  placeholder="Value"
                  placeholderTextColor={COLORS.textMuted}
                  value={row.value}
                  onChangeText={(t) => updateKvValue(i, t)}
                />
                <TouchableOpacity style={styles.kvRemove} onPress={() => removeKvRow(i)}>
                  <Text style={styles.kvRemoveText}>−</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity style={styles.addRowBtn} onPress={addKvRow}>
              <Text style={styles.addRowBtnText}>+ Add another field</Text>
            </TouchableOpacity>
          </View>

          {/* Notes blob */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.sectionHint}>
              Free text. "udhaar 2400, bohot purana customer" works fine.
            </Text>
            <TextInput
              style={[styles.formInput, styles.notesInput]}
              placeholder="Anything else..."
              placeholderTextColor={COLORS.textMuted}
              value={newNotes}
              onChangeText={setNewNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleAddContact}>
            <Text style={styles.saveBtnText}>Save contact</Text>
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
          <Text style={styles.emptyTitle}>No contacts yet</Text>
          <Text style={styles.emptySubtext}>
            Tap the + button to add your first contact
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.contactCard}>
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
            </View>
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
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Import from phone</Text>
            <Text style={styles.modalCount}>
              {importSelected.size > 0 ? `${importSelected.size} picked` : ' '}
            </Text>
          </View>

          {importLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.emptySubtext}>Reading your phone book…</Text>
            </View>
          ) : (
            <>
              <View style={[styles.searchRow, { paddingTop: 6 }]}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by name or number"
                  placeholderTextColor={COLORS.textMuted}
                  value={importSearch}
                  onChangeText={setImportSearch}
                />
              </View>

              {filteredDeviceContacts.length === 0 ? (
                <View style={styles.center}>
                  <Text style={styles.emptyTitle}>Nothing new to import</Text>
                  <Text style={styles.emptySubtext}>
                    Every contact in your phone book is already saved here.
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
                        ? `Import ${importSelected.size} contact${importSelected.size === 1 ? '' : 's'}`
                        : 'Pick contacts to import'}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  searchRow: { flexDirection: 'row', padding: 12, gap: 10 },
  searchInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  addBtn: {
    width: 44,
    height: 44,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: COLORS.textOnInk, fontSize: 22, fontWeight: '600' },

  iconBtn: {
    width: 44,
    height: 44,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { color: COLORS.text, fontSize: 22, fontWeight: '600', marginTop: -2 },

  addForm: {
    margin: 12,
    marginTop: 0,
    maxHeight: 460,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addFormInner: {
    padding: 14,
    gap: 10,
  },
  formInput: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },

  section: { gap: 8, paddingTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  sectionHint: { fontSize: 12, color: COLORS.textMuted, marginTop: -4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipText: { fontSize: 12, color: COLORS.text, fontWeight: '600' },

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
  addRowBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.text },

  notesInput: { minHeight: 70, paddingTop: 10 },

  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: COLORS.textOnInk, fontWeight: '700', fontSize: 14 },

  list: { padding: 12, paddingTop: 0 },
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
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '700', color: COLORS.primary },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  contactPhone: { fontSize: 13, color: COLORS.textMuted, marginTop: 1 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  emptySubtext: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },

  // ---- Phone-book import modal ----
  modalContainer: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56, // safe area-ish for now; replace with insets if a header lib is added
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, flex: 1, textAlign: 'center' },
  modalClose: { fontSize: 14, color: COLORS.textSecondary, width: 60 },
  modalCount: { fontSize: 12, color: COLORS.textMuted, width: 60, textAlign: 'right' },

  contactCardPicked: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.text,
  },
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

  modalFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  saveBtnDisabled: { opacity: 0.4 },
});
