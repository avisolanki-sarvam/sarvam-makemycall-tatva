import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../src/stores/authStore';
import { COLORS } from '../src/constants/api';
import { api } from '../src/services/api';

interface DashboardSnapshot {
  agentCount?: number;
  hasAgent?: boolean;
}

/**
 * Splash / route resolver.
 *
 * Routing tree:
 *   isHydrating              → loading spinner (reading tokens from secure store)
 *   !isLoggedIn              → /(auth)/login
 *   logged in                → fetch /user/dashboard once
 *   server says "has agents" → /(tabs)
 *   server says "no agents"  → /profile-setup        ← resume mid-journey
 *   server unreachable       → fall back to local user.onboardingDone flag
 *
 * Why hit /user/dashboard instead of trusting user.onboardingDone alone:
 * the local flag can drift from Postgres. Two cases we've seen:
 *   1. DB reset during testing — agents wiped, but local store still has
 *      onboardingDone=true → user lands on home with no agents, dead end.
 *   2. FTUX abandoned — user logged in, never typed a description, killed
 *      the app. onboardingDone is false so the local flag works here, but
 *      this defends against future paths that might set the flag eagerly.
 *
 * If the dashboard call fails (offline, transient) we fall back to the
 * local flag — better than blocking the user forever.
 */
export default function Index() {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const onboardingDone = useAuthStore((s) => s.user?.onboardingDone);

  const [serverChecked, setServerChecked] = useState(false);
  const [hasAgentsServer, setHasAgentsServer] = useState<boolean | null>(null);

  useEffect(() => {
    if (isHydrating || !isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<DashboardSnapshot>('/user/dashboard');
        if (cancelled) return;
        const count =
          typeof data.agentCount === 'number'
            ? data.agentCount
            : data.hasAgent
              ? 1
              : 0;
        setHasAgentsServer(count > 0);
      } catch (err) {
        // Token expired / network error — fall back to local flag.
        if (!cancelled) setHasAgentsServer(null);
      } finally {
        if (!cancelled) setServerChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHydrating, isLoggedIn]);

  // Hold here while reading tokens from secure store — avoids flashing login.
  if (isHydrating) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.ink} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/(auth)/login" />;
  }

  // Wait for the dashboard probe so we don't flash the wrong screen for a
  // returning user.
  if (!serverChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.ink} />
      </View>
    );
  }

  // Server says "has agents" → home. Server unreachable → fall back to flag.
  const ftuxComplete =
    hasAgentsServer !== null ? hasAgentsServer : !!onboardingDone;

  if (!ftuxComplete) {
    return <Redirect href="/profile-setup" />;
  }

  return <Redirect href="/(tabs)" />;
}
