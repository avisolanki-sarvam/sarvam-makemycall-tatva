import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useAuthStore } from '../src/stores/authStore';

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settings/edit-profile" />
    </Stack>
  );
}
