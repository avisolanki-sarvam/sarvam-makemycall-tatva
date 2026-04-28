import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/stores/authStore';
import { api } from '../src/services/api';
import { COLORS } from '../src/constants/api';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'kn', label: 'Kannada' },
  { code: 'mr', label: 'Marathi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'gu', label: 'Gujarati' },
];

export default function ProfileSetupScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessDesc, setBusinessDesc] = useState('');
  const [language, setLanguage] = useState('en');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'profile' | 'description' | 'creating'>('profile');

  // Top-left back chevron behaviour:
  // - On the description step, just rewind one sub-step (don't lose typed input).
  // - On the profile step, "back" means "I want to use a different number" — log
  //   out and bounce to login. Using router.back() here would briefly flash the
  //   OTP screen, which is confusing.
  const handleHeaderBack = () => {
    if (step === 'description') {
      setStep('profile');
      return;
    }
    Alert.alert(
      'Use a different number?',
      'You\'ll need to log in again with the new number.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: () => {
            logout();
            router.replace('/(auth)/login');
          },
        },
      ],
    );
  };

  const handleNext = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    setStep('description');
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      setIsRecording(false);
      // TODO: Integrate expo-audio for real recording
      // For now, simulate a transcribed description
      if (!businessDesc) {
        setBusinessDesc('We are a business that provides quality services to our customers.');
      }
    } else {
      // Start recording
      setIsRecording(true);
      // TODO: Start expo-audio recording
      // const { recording } = await Audio.Recording.createAsync(
      //   Audio.RecordingOptionsPresets.HIGH_QUALITY
      // );
    }
  };

  const handleCreateAgent = async () => {
    if (!businessDesc.trim() || businessDesc.trim().length < 20) {
      Alert.alert('Tell us more', 'Please describe your business in at least a few sentences.');
      return;
    }

    setStep('creating');
    setLoading(true);

    try {
      // Update profile name first
      await api.put('/user/profile', { name, businessName });

      // Create agent from description
      const result = await api.post<{ success: boolean; agent: any }>('/agents', {
        businessDescription: businessDesc,
        language,
      });

      if (!result?.success) {
        throw new Error('Agent creation failed');
      }

      // Mark onboarding done only after confirmed success
      setUser({ name, businessName, onboardingDone: true });
      // Explicit redirect — root layout doesn't watch auth state
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create your AI agent. Please try again.');
      setStep('description');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'creating') {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.creatingTitle}>Creating your assistant...</Text>
        <Text style={styles.creatingSubtitle}>
          Reading your description and setting up your personalised AI phone secretary
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <TouchableOpacity
        onPress={handleHeaderBack}
        style={styles.headerBack}
        hitSlop={12}
        accessibilityLabel="Back"
      >
        <Text style={styles.headerBackText}>{step === 'profile' ? '←' : '← Back'}</Text>
      </TouchableOpacity>
      <View style={styles.header}>
        <Text style={styles.stepIndicator}>
          Step {step === 'profile' ? '1' : '2'} of 2
        </Text>
        <Text style={styles.title}>
          {step === 'profile' ? 'Set up your profile' : 'Tell us about your business'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 'profile'
            ? "Just the basics — name, business, language"
            : "Describe in your own words — Hindi, English, anything works."}
        </Text>
      </View>

      {step === 'profile' ? (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Your name *</Text>
            <TextInput
              style={styles.input}
              placeholder="John Doe"
              placeholderTextColor={COLORS.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Business name (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="My Business"
              placeholderTextColor={COLORS.textMuted}
              value={businessName}
              onChangeText={setBusinessName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Preferred language</Text>
            <View style={styles.languageGrid}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.langChip,
                    language === lang.code && styles.langChipActive,
                  ]}
                  onPress={() => setLanguage(lang.code)}
                >
                  <Text
                    style={[
                      styles.langChipText,
                      language === lang.code && styles.langChipTextActive,
                    ]}
                  >
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleNext}>
            <Text style={styles.buttonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Business description</Text>
            <Text style={styles.hint}>
              What does your business do? What kind of calls would you like to make?
              The more detail you give, the better your AI agent will be.
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="e.g., I run a small finance company that provides personal loans. I need to make collection reminder calls to customers whose EMI payments are overdue..."
              placeholderTextColor={COLORS.textMuted}
              value={businessDesc}
              onChangeText={setBusinessDesc}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.recordButton, isRecording && styles.recordButtonActive]}
            onPress={handleToggleRecording}
          >
            <Text style={styles.recordButtonIcon}>{isRecording ? '⏹' : '🎙'}</Text>
            <Text style={[styles.recordButtonText, isRecording && styles.recordButtonTextActive]}>
              {isRecording ? 'Stop recording' : 'Or tap to describe by voice'}
            </Text>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => setStep('profile')}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonFlex, loading && styles.buttonDisabled]}
              onPress={handleCreateAgent}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Create my assistant</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 24, paddingTop: 60 },
  headerBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 14 },
  headerBackText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary },
  header: { marginBottom: 32 },
  stepIndicator: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, lineHeight: 22 },
  form: { gap: 20 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  hint: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },
  textArea: { minHeight: 140, paddingTop: 14 },
  languageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  langChipActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  langChipText: { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },
  langChipTextActive: { color: COLORS.primary, fontWeight: '700' },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surface,
  },
  recordButtonActive: { borderColor: COLORS.danger, backgroundColor: COLORS.statusDeclinedBg },
  recordButtonIcon: { fontSize: 20 },
  recordButtonText: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  recordButtonTextActive: { color: COLORS.danger },
  buttonRow: { flexDirection: 'row', gap: 12 },
  backBtn: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonFlex: { flex: 1 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.textOnInk, fontSize: 16, fontWeight: '700' },
  creatingTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginTop: 24, marginBottom: 8 },
  creatingSubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 },
});
