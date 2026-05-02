import { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, LogBox, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Hide the in-app yellow "Open debugger to see X warnings" strip.
// Warnings still print to the Metro terminal — we just don't want them
// stealing space at the bottom of the app while we're polishing UX.
// To temporarily re-enable for debugging, comment this line out.
LogBox.ignoreAllLogs(true);
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_500Medium,
} from '@expo-google-fonts/fraunces';
// NOTE on icon fonts: we deliberately do NOT load Feather/MaterialIcons via
// `useFonts` here. Those .ttfs are bundled at BUILD time via the `expo-font`
// config plugin in app.json, which copies the font into the native binary
// and registers it with the OS font system. This avoids a runtime
// `Asset.downloadAsync` call that crashes on stale dev clients with the
// ABI mismatch `NoSuchMethodError: getFilePermission()`. If you add another
// vector-icon set, append its .ttf path to the `expo-font` plugin entry in
// app.json — do NOT spread `.font` into useFonts.
import { useAuthStore } from '../src/stores/authStore';
import PersistentTabBar from '../src/components/PersistentTabBar';
import { AppThemeProvider, useAppTheme } from '../src/theme/AppThemeProvider';
// Side-effect import: initialises i18next + react-i18next once at app
// boot so every screen's `useTranslation()` hook resolves immediately.
import '../src/i18n';

/**
 * Root layout.
 *
 *   1. Fraunces (Tatva's "Season" serif substitute) is loaded BEFORE
 *      the screen stack mounts — but with a hard 3-second timeout. If
 *      the bundle never delivers the font weights (Metro cache issue,
 *      asset-registry hiccup, etc.) we fall through to the system
 *      serif so the app NEVER hangs on a spinner. Headings just lose
 *      their editorial flavour until the next reload.
 *
 *      We also log loading errors to console so a stuck bundle is at
 *      least visible in `adb logcat | grep -i "fraunces\|fontError"`.
 *
 *   2. SafeAreaProvider wraps everything so child screens can read
 *      real device safe-area insets via useSafeAreaInsets().
 *
 *   3. PersistentTabBar is mounted as a SIBLING of the Stack so the
 *      bar survives every route change. It self-hides on auth +
 *      onboarding paths and when the keyboard is open.
 */
export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootLayoutContent />
    </AppThemeProvider>
  );
}

function RootLayoutContent() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const { colors, scheme } = useAppTheme();

  // useFonts returns [loaded, error]. We watch both — if `error` fires
  // we still proceed (system fallback), but we log so the dev can see
  // the failure in the Metro/adb logs.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
  });

  // Hard timeout: if fonts haven't resolved in 3s, force-proceed. This
  // is what stops a stuck Metro bundle from leaving the user on a
  // perpetual spinner. The app will use system serif until the next
  // launch, when fonts have a chance to load again.
  const [proceedAnyway, setProceedAnyway] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProceedAnyway(true), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (fontError) {
      console.warn('[fontError] Fraunces failed to load:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const buttonStyle = scheme === 'dark' ? 'light' : 'dark';
    const navStyle = scheme === 'dark' ? 'dark' : 'light';
    let cancelled = false;

    void import('expo-navigation-bar')
      .then((NavigationBar) => {
        if (cancelled) return;
        NavigationBar.setStyle(navStyle);
        void NavigationBar.setButtonStyleAsync(buttonStyle).catch(() => undefined);
        void NavigationBar.setBackgroundColorAsync(colors.surfacePrimary).catch(() => undefined);
        void NavigationBar.setBorderColorAsync(colors.borderPrimary).catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [colors.borderPrimary, colors.surfacePrimary, scheme]);

  const ready = fontsLoaded || !!fontError || proceedAnyway;

  if (!ready) {
    return (
      <View style={[styles.shell, styles.center, { backgroundColor: colors.surfacePrimary }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={[styles.shell, { backgroundColor: colors.surfacePrimary }]}>
        <StatusBar
          style={scheme === 'dark' ? 'light' : 'dark'}
          backgroundColor={colors.surfacePrimary}
        />
        <View style={styles.stackHost}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surfacePrimary },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="profile-setup" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings/edit-profile" />
            <Stack.Screen name="settings/language" />
            <Stack.Screen name="agents/index" />
            <Stack.Screen name="agents/new" />
            <Stack.Screen name="credits" />
            <Stack.Screen name="contacts/[id]/edit" />
          </Stack>
        </View>
        <PersistentTabBar />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  stackHost: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
