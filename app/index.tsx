import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../src/stores/authStore';
import { COLORS } from '../src/constants/api';

export default function Index() {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const onboardingDone = useAuthStore((s) => s.user?.onboardingDone);

  // While we read tokens from secure store, hold here so we don't flash the
  // login screen for a returning user.
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

  if (!onboardingDone) {
    return <Redirect href="/profile-setup" />;
  }

  return <Redirect href="/(tabs)" />;
}
