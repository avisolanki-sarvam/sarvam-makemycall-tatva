import { Text, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../src/constants/api';

/**
 * Bottom tab bar.
 *
 * Height + paddingBottom are computed from the device's safe-area inset so
 * the bar floats above Android's gesture-nav pill / 3-button nav and iOS's
 * home indicator. On older Android phones with on-screen nav buttons the
 * inset is ~48dp; on S23 Ultra-class phones with gesture nav it's ~16-24dp;
 * on devices without any system nav bar the inset is 0 and the tab bar is
 * just its base height (56dp). Hardcoding height: 56 used to put the icons
 * underneath the Android nav bar — Settings was unreachable.
 */
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const baseHeight = 56;
  // Android gesture nav reports a small inset (~16dp); 3-button nav reports
  // ~48dp. iOS home indicator is ~34dp. We add the inset on top of base.
  const bottomInset = insets.bottom;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          paddingTop: 4,
          paddingBottom: bottomInset,
          height: baseHeight + bottomInset,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        headerStyle: { backgroundColor: COLORS.surface },
        headerTitleStyle: { fontWeight: '500', color: COLORS.text },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabIcon label="🏠" color={color} />,
          headerTitle: 'MakeMyCall',
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color }) => <TabIcon label="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Campaigns',
          tabBarIcon: ({ color }) => <TabIcon label="📋" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon label="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ label, color }: { label: string; color: string }) {
  return <Text style={{ fontSize: 20, opacity: color === COLORS.primary ? 1 : 0.5 }}>{label}</Text>;
}
