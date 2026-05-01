/**
 * /agents/[id]/test-call
 *
 * Lets the user place a one-off test call from a deployed agent to a single
 * phone number. Two fields: name + phone. Backend dials via Sarvam outbound
 * API. The user's own phone (or whoever they paste) rings within ~5 seconds
 * of submission.
 *
 * Hits POST /agents/:id/test-call. Backend preconditions:
 *   - agent.status === 'ready'
 *   - agent.phoneNumber !== null     (i.e. deploy step completed)
 *
 * Failure modes the user might see:
 *   - 'agent_not_ready' — agent is still being authored / failed during authoring
 *   - 'agent_no_phone'  — pool was empty at create time, deploy never completed
 *   - 'invalid_phone'   — they typed a non-E.164 string
 *   - 'outbound_failed' — Sarvam-side rejected (rare; usually permission / quota)
 *
 * Backend defaults to E.164 with the leading +. Mobile auto-prepends +91
 * if user types a 10-digit Indian number without the country code, since
 * that's the most common entry pattern for our target persona.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../../src/services/api';
import { COLORS } from '../../../src/constants/api';

interface TestCallResponse {
  success: boolean;
  outboundId: string | null;
  status: string | null;
  message: string;
}

export default function TestCallScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { id: agentId } = useLocalSearchParams<{ id: string }>();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handlePlaceCall = async () => {
    if (submitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert(t('agents.testCall.alerts.nameNeededTitle'), t('agents.testCall.alerts.nameNeededBody'));
      return;
    }

    // Phone normalisation: strip spaces / dashes; if it's 10 digits with no
    // country code, prepend +91 (most common Indian entry pattern); otherwise
    // require a leading +.
    const cleaned = phone.replace(/[\s-]/g, '');
    let e164 = cleaned;
    if (/^\d{10}$/.test(cleaned)) {
      e164 = '+91' + cleaned;
    } else if (/^\+\d{10,15}$/.test(cleaned)) {
      // Already valid E.164.
    } else {
      Alert.alert(
        t('agents.testCall.alerts.phoneFormatTitle'),
        t('agents.testCall.alerts.phoneFormatBody'),
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<TestCallResponse>(
        `/agents/${agentId}/test-call`,
        { name: trimmedName, phoneNumber: e164 },
      );

      Alert.alert(
        t('agents.testCall.alerts.callingNowTitle'),
        res.message || t('agents.testCall.alerts.callingNowFallback', { name: trimmedName, phone: e164 }),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      const msg = err?.message || t('agents.testCall.alerts.testCallFailedFallback');
      Alert.alert(t('agents.testCall.alerts.testCallFailedTitle'), msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('agents.testCall.title')}</Text>
        <Text style={styles.subtitle}>
          {t('agents.testCall.subtitle')}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t('agents.testCall.nameLabel')}</Text>
          <Text style={styles.helper}>
            {t('agents.testCall.nameHint')}
            <Text style={styles.code}>{'{{customer_name}}'}</Text>
            {t('agents.testCall.nameHintEnd')}
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('agents.testCall.namePlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="words"
            returnKeyType="next"
            maxLength={60}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('agents.testCall.phoneLabel')}</Text>
          <Text style={styles.helper}>
            {t('agents.testCall.phoneHint')}
          </Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('agents.testCall.phonePlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            keyboardType="phone-pad"
            returnKeyType="done"
            maxLength={16}
            onSubmitEditing={handlePlaceCall}
          />
        </View>

        <TouchableOpacity
          style={[styles.callBtn, submitting && styles.callBtnDisabled]}
          onPress={handlePlaceCall}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.textOnInk} />
          ) : (
            <Text style={styles.callText}>{t('agents.testCall.placeCall')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          {t('agents.testCall.footnote')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 60 },

  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 24 },

  field: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  helper: { fontSize: 12, color: COLORS.textMuted, marginBottom: 8, lineHeight: 16 },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
  },

  callBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  callBtnDisabled: { opacity: 0.6 },
  callText: { color: COLORS.textOnInk, fontSize: 15, fontWeight: '700' },

  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' },

  footnote: { fontSize: 11, color: COLORS.textMuted, lineHeight: 16, marginTop: 18, textAlign: 'center' },
});
