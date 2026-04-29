import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';

/**
 * Root layout. Wraps everything in SafeAreaProvider so child screens — most
 * importantly the bottom tab bar in app/(tabs)/_layout.tsx — can read the
 * real device safe-area insets via useSafeAreaInsets(). Without this, the
 * hook returns zeros and tab-bar icons end up hidden behind Android's
 * gesture-nav pill / 3-button nav bar.
 */
export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings/edit-profile" />
      </Stack>
    </SafeAreaProvider>
  );
}
