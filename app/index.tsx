/**
 * Splash / route resolver.
 *
 * Visual treatment mirrors Indus's two-phase animation pattern from the
 * web (CSS `bloom` + `float2`):
 *
 *   1. Bloom entrance     — mark scales 0.55 → 1.0 with a soft spring,
 *                            opacity 0 → 1, ~700ms.
 *   2. Idle float         — once bloomed, the mark bobs gently along Y
 *                            (±5px) on a 2.5s ease-in-out loop. Reads
 *                            "alive" without being distracting.
 *   3. Wordmark fade-in   — "MakeMyCall" type fades in 200ms after the
 *                            mark settles. The Sarvam motif itself is
 *                            already the brand signal, so the wordmark
 *                            here names the product (MakeMyCall), not
 *                            the company.
 *   4. Min-show window    — splash holds for at least MIN_SHOW_MS so the
 *                            animation has time to be felt; if hydration
 *                            finishes earlier we still wait. If hydration
 *                            takes longer we wait on it.
 *   5. Outgoing fade      — the whole shell fades 200ms before the
 *                            redirect, giving the next screen a soft
 *                            handoff instead of a hard cut.
 *
 * Routing once hydration completes:
 *   !isLoggedIn  → /(auth)/login   (the welcome / phone-entry screen)
 *   logged in    → /(tabs)
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/stores/authStore';
import { TatvaColors, Spacing } from '../src/constants/theme';
import { BrandMark } from '../src/components/BrandMark';
import { AppText } from '../src/components/AppText';

// Min splash hold — long enough to feel the bloom + a beat of float.
// Tuned by hand on the device; under ~1.0s the animation reads as a
// flicker, over ~1.8s it starts to feel like a delay.
const MIN_SHOW_MS = 1300;
// Fade-out before the redirect. A perceptual gap between splash and
// the next screen mount, not so long that it feels broken.
const FADE_OUT_MS = 220;

export default function Index() {
  const router = useRouter();
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  // Animation drivers — all useRef so the values survive re-renders.
  const markScale = useRef(new Animated.Value(0.55)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordTranslate = useRef(new Animated.Value(8)).current;
  const floatY = useRef(new Animated.Value(0)).current;
  const shellOpacity = useRef(new Animated.Value(1)).current;

  // Track when the splash mounted; we hold the splash visible for at
  // least MIN_SHOW_MS regardless of how fast hydrate() resolves.
  const mountedAt = useRef(Date.now());
  const [destination, setDestination] = useState<string | null>(null);

  // ── Bloom entrance + idle float — fired once on mount.
  useEffect(() => {
    Animated.parallel([
      Animated.spring(markScale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 9,
        mass: 0.9,
        stiffness: 120,
      }),
      Animated.timing(markOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Wordmark joins ~250ms after the mark starts blooming.
    Animated.sequence([
      Animated.delay(250),
      Animated.parallel([
        Animated.timing(wordOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(wordTranslate, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Idle float — Y bobbing on a 2.5s loop. Starts 700ms in so the
    // bloom finishes first, then the loop takes over.
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, {
          toValue: -5,
          duration: 1250,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatY, {
          toValue: 0,
          duration: 1250,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const t = setTimeout(() => floatLoop.start(), 700);

    return () => {
      clearTimeout(t);
      floatLoop.stop();
    };
  }, [floatY, markOpacity, markScale, wordOpacity, wordTranslate]);

  // ── Decide where to go once hydration finishes, but enforce the
  // MIN_SHOW_MS floor so the splash always feels intentional.
  useEffect(() => {
    if (isHydrating) return;
    const elapsed = Date.now() - mountedAt.current;
    const wait = Math.max(0, MIN_SHOW_MS - elapsed);
    const dest = isLoggedIn ? '/(tabs)' : '/(auth)/login';
    const tShow = setTimeout(() => setDestination(dest), wait);
    return () => clearTimeout(tShow);
  }, [isHydrating, isLoggedIn]);

  // ── Fade out, then navigate. The fade-out gives the next screen's
  // mount a soft handoff instead of cutting hard.
  useEffect(() => {
    if (!destination) return;
    Animated.timing(shellOpacity, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      router.replace(destination as any);
    });
  }, [destination, router, shellOpacity]);

  return (
    <Animated.View style={[styles.shell, { opacity: shellOpacity }]}>
      <View style={styles.center}>
        <Animated.View
          style={{
            transform: [{ scale: markScale }, { translateY: floatY }],
            opacity: markOpacity,
          }}
        >
          <BrandMark size={140} variant="gradient" />
        </Animated.View>

        <Animated.View
          style={{
            opacity: wordOpacity,
            transform: [{ translateY: wordTranslate }],
            marginTop: Spacing['10'],
          }}
        >
          <AppText variant="display-md" align="center" style={styles.wordmark}>
            MakeMyCall
          </AppText>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: TatvaColors.surfacePrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  wordmark: {
    letterSpacing: -0.6,
  },
});
