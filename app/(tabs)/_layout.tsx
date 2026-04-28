import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { COLORS } from '../../src/constants/api';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          paddingTop: 4,
          height: 56,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: { backgroundColor: COLORS.surface },
        headerTitleStyle: { fontWeight: '700', color: COLORS.text },
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
