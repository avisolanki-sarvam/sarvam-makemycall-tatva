import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';
import PersistentTabBar from '../src/components/PersistentTabBar';
import { TatvaColors } from '../src/constants/theme';
// Side-effect import: initialises i18next + react-i18next once at app
// boot so every screen's `useTranslation()` hook resolves immediately.
import '../src/i18n';

/**
 * Root layout.
 *
 *   1. SafeAreaProvider wraps everything so child screens — most
 *      importantly the bottom tab bar — can read real device safe-area
 *      insets via useSafeAreaInsets(). Without this the hook returns
 *      zeros and the bar ends up under Android's gesture pill.
 *
 *   2. The Stack handles route navigation as usual.
 *
 *   3. PersistentTabBar is mounted as a SIBLING of the Stack so the bar
 *      survives every route change. It self-hides on auth + onboarding
 *      paths and when the keyboard is open. Tapping a tab issues a
 *      router.replace into the (tabs) group.
 *
 * NB. Each screen still needs its own bottom padding to keep content
 * out from under the bar — see `tabBarHeight()` in PersistentTabBar.
 */
export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <SafeAreaProvider>
      <View style={styles.shell}>
        {/* Stack takes the remaining height. When PersistentTabBar
            returns null (auth screens, keyboard open) the stack
            reflows full-screen. */}
        <View style={styles.stackHost}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: TatvaColors.surfacePrimary },
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
          </Stack>
        </View>
        <PersistentTabBar />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },
  stackHost: { flex: 1 },
});
