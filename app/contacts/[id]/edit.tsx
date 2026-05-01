/**
 * /contacts/[id]/edit — Edit a saved contact.
 *
 * Routed to from the Contacts tab when the user taps a contact row (or
 * the trailing pencil icon). Form fields:
 *
 *   1. Name
 *   2. Phone (10-digit, +91 implied)
 *   3. Notes (free-form, multi-line)
 *   4. Custom fields (key/value rows). Tap "+" to add another row.
 *
 * Save → PUT /contacts/:id with the trimmed payload, update the local
 * Zustand store with the returned canonical contact, route back.
 *
 * Delete → confirm Alert → DELETE /contacts/:id, remove from store,
 * route back. Destructive action lives at the bottom of the screen,
 * separated from save by a hairline + warning copy.
 *
 * Behavioural notes:
 *  - We hydrate from the local store first (instant render). If the
 *    contact isn't in the store (e.g. deep-link), we GET /contacts/:id
 *    once and seed the form.
 *  - Phone is the only required field that can change validation state
 *    on the fly. A red helper line appears under the input when the
 *    value isn't a 10-digit number.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CaretLeftIcon, PlusIcon, XIcon } from 'phosphor-react-native';
import { api } from '../../../src/services/api';
import { useContactStore, type Contact } from '../../../src/stores/contactStore';
import {
  TatvaColors,
  Radius,
  Spacing,
  Type,
  Weight,
} from '../../../src/constants/theme';
import { AppText } from '../../../src/components/AppText';
import { Input } from '../../../src/components/Input';
import { Button } from '../../../src/components/Button';
import { TatvaIcon } from '../../../src/components/TatvaIcon';

interface KVRow {
  key: string;
  value: string;
}

const newRow = (): KVRow => ({ key: '', value: '' });

export default function EditContactScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { t } = useTranslation();

  const contacts = useContactStore((s) => s.contacts);
  const updateContact = useContactStore((s) => s.updateContact);
  const removeContact = useContactStore((s) => s.removeContact);

  const initial = useMemo<Contact | null>(
    () => contacts.find((c) => c.id === id) || null,
    [contacts, id],
  );

  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [kvRows, setKvRows] = useState<KVRow[]>(() => {
    const cf = initial?.customFields || {};
    const entries = Object.entries(cf);
    return entries.length > 0
      ? entries.map(([key, value]) => ({ key, value }))
      : [newRow()];
  });
  const [hydrating, setHydrating] = useState(initial == null);
  const [saving, setSaving] = useState(false);

  // If the user deep-linked into this screen and the local store didn't
  // already have the contact, fetch once.
  useEffect(() => {
    if (initial != null || !id) return;
    let alive = true;
    (async () => {
      try {
        const res = await api.get<{ contact: Contact }>(`/contacts/${id}`);
        if (!alive || !res?.contact) return;
        setName(res.contact.name || '');
        setPhone(res.contact.phone || '');
        setNotes(res.contact.notes || '');
        const cf = res.contact.customFields || {};
        const entries = Object.entries(cf);
        setKvRows(
          entries.length > 0
            ? entries.map(([key, value]) => ({ key, value }))
            : [newRow()],
        );
      } catch {
        Alert.alert(
          t('contacts.edit.notFoundTitle'),
          t('contacts.edit.notFoundBody'),
          [{ text: t('common.ok'), onPress: () => router.back() }],
        );
      } finally {
        if (alive) setHydrating(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, initial, router, t]);

  const phoneCleaned = phone.replace(/\D/g, '');
  const phoneValid = phoneCleaned.length >= 10;
  const nameValid = name.trim().length > 0;
  const canSave = nameValid && phoneValid && !saving;

  const handleSave = async () => {
    if (!canSave || !id) return;
    setSaving(true);
    // Drop empty key/value rows; skip pairs where the key alone is filled
    // but the value is blank (and vice-versa).
    const customFields: Record<string, string> = {};
    for (const r of kvRows) {
      const k = r.key.trim();
      const v = r.value.trim();
      if (k && v) customFields[k] = v;
    }
    try {
      const res = await api.put<{ contact: Contact }>(`/contacts/${id}`, {
        name: name.trim(),
        phone: phoneCleaned,
        notes: notes.trim() || null,
        customFields,
      });
      if (res?.contact) updateContact(res.contact);
      router.back();
    } catch (err: any) {
      Alert.alert(
        t('contacts.edit.saveFailedTitle'),
        err?.message || t('contacts.edit.saveFailedBody'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert(
      t('contacts.edit.deleteTitle'),
      t('contacts.edit.deleteBody', { name: name || t('contacts.edit.unknown') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contacts.edit.deleteConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete<{ success: boolean }>(`/contacts/${id}`);
              removeContact(id);
              router.back();
            } catch (err: any) {
              Alert.alert(
                t('contacts.edit.deleteFailedTitle'),
                err?.message || t('contacts.edit.deleteFailedBody'),
              );
            }
          },
        },
      ],
    );
  };

  const updateKv = (idx: number, patch: Partial<KVRow>) => {
    setKvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const removeKv = (idx: number) => {
    setKvRows((prev) => prev.filter((_, i) => i !== idx));
  };
  const appendKv = () => setKvRows((prev) => [...prev, newRow()]);

  if (hydrating) {
    return (
      <SafeAreaView style={[styles.shell, styles.center]} edges={['top']}>
        <ActivityIndicator color={TatvaColors.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <CaretLeftIcon size={22} color={TatvaColors.contentPrimary} weight="regular" />
          </TouchableOpacity>
          <AppText variant="heading-md">{t('contacts.edit.title')}</AppText>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Input
            label={t('contacts.edit.nameLabel')}
            placeholder={t('contacts.edit.namePlaceholder')}
            value={name}
            onChangeText={setName}
            size="md"
            autoFocus={!initial}
          />

          <Input
            label={t('contacts.edit.phoneLabel')}
            prefix="+91"
            placeholder={t('contacts.edit.phonePlaceholder')}
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
            size="md"
            error={phone.length > 0 && !phoneValid ? t('contacts.edit.phoneInvalid') : undefined}
          />

          <View style={styles.notesBlock}>
            <AppText variant="label-md" tone="secondary">
              {t('contacts.edit.notesLabel')}
            </AppText>
            <View style={styles.notesShell}>
              <TextInput
                style={styles.notesInput}
                placeholder={t('contacts.edit.notesPlaceholder')}
                placeholderTextColor={TatvaColors.contentQuaternary}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </View>

          <View style={styles.cfBlock}>
            <AppText variant="label-md" tone="secondary">
              {t('contacts.edit.customFieldsLabel')}
            </AppText>
            <AppText variant="body-xs" tone="tertiary">
              {t('contacts.edit.customFieldsHint')}
            </AppText>
            <View style={styles.cfRows}>
              {kvRows.map((row, idx) => (
                <View key={idx} style={styles.cfRow}>
                  <View style={styles.cfFieldHalf}>
                    <Input
                      placeholder={t('contacts.edit.kvKeyPlaceholder')}
                      value={row.key}
                      onChangeText={(v) => updateKv(idx, { key: v })}
                      size="sm"
                    />
                  </View>
                  <View style={styles.cfFieldHalf}>
                    <Input
                      placeholder={t('contacts.edit.kvValuePlaceholder')}
                      value={row.value}
                      onChangeText={(v) => updateKv(idx, { value: v })}
                      size="sm"
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => removeKv(idx)}
                    style={styles.cfDelete}
                    hitSlop={8}
                  >
                    <XIcon size={14} color={TatvaColors.contentTertiary} weight="regular" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={appendKv} style={styles.cfAdd} activeOpacity={0.7}>
                <PlusIcon size={14} color={TatvaColors.contentPrimary} weight="regular" />
                <AppText variant="body-sm" style={{ fontWeight: Weight.semibold }}>
                  {t('contacts.edit.addField')}
                </AppText>
              </TouchableOpacity>
            </View>
          </View>

          <Button
            onPress={handleSave}
            isLoading={saving}
            disabled={!canSave}
            width="full"
            size="lg"
          >
            {t('contacts.edit.save')}
          </Button>

          <View style={styles.dangerBlock}>
            <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
              <TatvaIcon name="delete" size="sm" color={TatvaColors.dangerContent} />
              <AppText
                variant="body-sm"
                style={{ color: TatvaColors.dangerContent, fontWeight: Weight.semibold }}
              >
                {t('contacts.edit.delete')}
              </AppText>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['8'],
    paddingTop: Spacing['4'],
    paddingBottom: Spacing['4'],
  },
  backBtn: { paddingVertical: Spacing['2'] },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing['8'],
    paddingTop: Spacing['4'],
    paddingBottom: Spacing['8'],
    gap: Spacing['8'],
  },

  // ─── Notes block ─────────────────────────────────────────────
  notesBlock: { gap: Spacing['3'] },
  notesShell: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TatvaColors.borderSecondary,
    paddingHorizontal: Spacing['6'],
    paddingVertical: Spacing['5'],
    minHeight: 96,
  },
  notesInput: {
    flex: 1,
    minHeight: 80,
    color: TatvaColors.contentPrimary,
    ...Type.bodyMd,
  },

  // ─── Custom fields ──────────────────────────────────────────
  cfBlock: { gap: Spacing['3'] },
  cfRows: { gap: Spacing['3'] },
  cfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
  },
  cfFieldHalf: { flex: 1 },
  cfDelete: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: TatvaColors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cfAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing['5'],
    paddingVertical: Spacing['3'],
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderColor: TatvaColors.borderSecondary,
    marginTop: Spacing['1'],
  },

  // ─── Danger block (delete contact) ──────────────────────────
  dangerBlock: {
    paddingTop: Spacing['8'],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TatvaColors.borderPrimary,
    alignItems: 'center',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3'],
    paddingHorizontal: Spacing['8'],
    paddingVertical: Spacing['5'],
  },
});
