/**
 * /(auth) — Landing page.
 *
 * Marketing-style intro that explains what MakeMyCall is before asking the
 * user to enter a phone number. Sits in front of /(auth)/login so visitors
 * land on a "what is this?" page rather than a credential form on first
 * open. Tap "Get started" → /(auth)/login.
 *
 * The previous Redirect that lived here forwarded straight to /(auth)/login,
 * which made the splash → login transition feel abrupt and offered no
 * context to a first-time installer. Root /app/index.tsx now redirects
 * unauthenticated users to /(auth) so this is the new entry point.
 */

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/api';

interface Feature {
  icon: keyof typeof Feather.glyphMap;
  titleHi: string;
  titleEn: string;
  body: string;
}

// Three core value props. Kept terse — the tap-through to login should
// happen within ~5 seconds of arrival; this isn't a homepage, it's a
// before-login welcome.
const FEATURES: Feature[] = [
  {
    icon: 'users',
    titleHi: 'Personalized calls',
    titleEn: 'Har customer ka naam aur context',
    body: 'Aapka assistant har caller ka naam jaanta hai aur unke context ke hisaab se baat karta hai.',
  },
  {
    icon: 'globe',
    titleHi: 'Multi-language support',
    titleEn: '8 Indian bhashayein, automatic',
    body: 'Hindi, Tamil, Bengali, Telugu, Kannada, Marathi, Gujarati, English — sab mein.',
  },
  {
    icon: 'zap',
    titleHi: 'Automated campaigns',
    titleEn: 'Schedule, launch, track results',
    body: 'Ek baar setup karein, hazaron calls ek button se. Real-time results dekhe.',
  },
];

export default function LandingScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand mark — small pill, sets the cream/ink visual tone. */}
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>MakeMyCall</Text>
        </View>

        {/* Hero. Hindi title leads, English supporting line below. */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            Apne business ke liye AI calling assistant
          </Text>
          <Text style={styles.heroSubtitle}>
            Hindi, Tamil, Bengali — 8 bhashayein. Ek baar setup, hazaron calls.
          </Text>
        </View>

        {/* Feature cards. Tight stack — each card is one value prop, two
            sentences max so the page doesn't feel like a brochure. */}
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.icon} style={styles.featureCard}>
              <View style={styles.featureIcon}>
                <Feather name={f.icon} size={16} color={COLORS.ink} />
              </View>
              <View style={styles.featureCopy}>
                <Text style={styles.featureTitle}>{f.titleHi}</Text>
                <Text style={styles.featureSubtitle}>{f.titleEn}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Filled-ink CTA pinned to the bottom — matches the canonical
          primary-action treatment used across login / OTP / onboarding. */}
      <View style={styles.ctaBlock}>
        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.push('/(auth)/login')}
          accessibilityRole="button"
          accessibilityLabel="Get started"
        >
          <Text style={styles.ctaText}>Get started</Text>
        </TouchableOpacity>
        <Text style={styles.disclaimer}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 24, paddingTop: 24, paddingBottom: 16 },

  // Brand pill — small soft-cream chip with a 6px ink dot.
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 28,
  },
  brandDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.ink,
  },
  brandText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.ink,
    letterSpacing: 0.2,
  },

  // Hero — large Hindi-led title, English supporting subtitle.
  hero: { marginBottom: 28 },
  heroTitle: {
    fontSize: 26,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 26 * 1.25,
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 14 * 1.55,
  },

  // Feature card — paper surface, hairline border, icon medallion + copy stack.
  featureList: { gap: 10 },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    padding: 14,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: { flex: 1, gap: 2 },
  featureTitle: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  featureSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  featureBody: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 12 * 1.5,
  },

  // CTA block — hugs the bottom safe area. Filled ink button + tiny disclaimer.
  ctaBlock: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
    borderTopWidth: 0,
  },
  cta: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: { color: COLORS.textOnInk, fontSize: 14, fontWeight: '500' },
  disclaimer: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 11 * 1.55,
  },
});
