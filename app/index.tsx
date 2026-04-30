import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../src/stores/authStore';
import { COLORS } from '../src/constants/api';

/**
 * Splash / route resolver.
 *
 * Routing tree:
 *   isHydrating              → loading spinner (reading tokens from secure store)
 *   !isLoggedIn              → /(auth)        (the marketing landing page)
 *   logged in                → /(tabs)
 *
 * Note (Apr 2026): we used to gate /(tabs) on "user has at least one agent"
 * by hitting /user/dashboard from this splash and redirecting to
 * /profile-setup when hasAgent was false. That meant a freshly-signed-up
 * user could never reach Settings to log out, change profile, or get help —
 * they were trapped on profile-setup until they wrote a business
 * description. Now we always land logged-in users on /(tabs); the Home tab
 * handles the empty-state for users without an agent (a focused "create
 * your first assistant" hero that pushes to /profile-setup), and Settings
 * stays reachable via the tab bar from minute one.
 *
 * Note (Apr 2026, second pass): unauthenticated users now land on the
 * /(auth) marketing landing page rather than the bare /(auth)/login form.
 * Tap-through from landing → /(auth)/login.
 */
export default function Index() {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  if (isHydrating) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.ink} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/(auth)" />;
  }

  return <Redirect href="/(tabs)" />;
}
