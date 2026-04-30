import { Tabs } from 'expo-router';

/**
 * (tabs) layout — keeps the four tab routes wired up via Expo Router's
 * built-in `<Tabs>` navigator, but the bar itself is intentionally
 * hidden. The visible bottom navigation is rendered globally by
 * `PersistentTabBar` in `app/_layout.tsx` so it survives pushed
 * detail / wizard / edit screens.
 *
 * If you ever swap the global bar back to expo-router's stock tab UI,
 * undo `tabBarStyle: display: 'none'` here.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="contacts" options={{ title: 'Customers' }} />
      <Tabs.Screen name="history" options={{ title: 'Campaigns' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
