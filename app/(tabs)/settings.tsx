import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name || user?.phone || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.profileName}>{user?.name || 'User'}</Text>
        <Text style={styles.profilePhone}>+91 {user?.phone}</Text>
        {user?.businessName && (
          <Text style={styles.businessName}>{user.businessName}</Text>
        )}
      </View>

      {/* Menu Items */}
      <View style={styles.menu}>
        {/* Edit business profile — updates User row only (name, businessName,
            businessDesc) via PUT /user/profile. Does NOT create a new agent. */}
        <MenuItem
          label="Edit business profile"
          icon="✏️"
          onPress={() => router.push('/settings/edit-profile')}
        />
        {/* Author another agent — re-uses the FTUX screen. Creates a NEW
            agent + overwrites businessDesc on the User row. Backend supports
            many agents per user. */}
        <MenuItem
          label="Author another agent"
          icon="🤖"
          onPress={() => router.push('/profile-setup')}
        />
        <MenuItem label="Credit history" icon="💳" />
        <MenuItem label="Notification preferences" icon="🔔" />
        <MenuItem label="Help and support" icon="❓" />
        <MenuItem label="About MakeMyCall" icon="ℹ️" />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>MakeMyCall v1.0.0</Text>
    </View>
  );
}

function MenuItem({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: string;
  onPress?: () => void;
}) {
  // When onPress isn't provided, render visually but make it explicit that
  // the item is a stub — easier to spot the next set of TODOs.
  const isStub = !onPress;
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      disabled={isStub}
      activeOpacity={isStub ? 1 : 0.6}
    >
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={[styles.menuLabel, isStub && styles.menuLabelStub]}>
        {label}{isStub ? '  (coming soon)' : ''}
      </Text>
      <Text style={styles.menuArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: 16 },

  profileCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    marginBottom: 20,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 24, fontWeight: '500', color: COLORS.ink },
  profileName: { fontSize: 18, fontWeight: '500', color: COLORS.text },
  profilePhone: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  businessName: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500', marginTop: 4 },

  menu: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.borderSoft,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderSoft,
    gap: 12,
  },
  menuIcon: { fontSize: 16 },
  menuLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: COLORS.text },
  menuLabelStub: { color: COLORS.textMuted, fontWeight: '400' },
  menuArrow: { fontSize: 18, color: COLORS.textMuted },

  logoutBtn: {
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.danger,
    alignItems: 'center',
  },
  logoutText: { fontSize: 13, fontWeight: '500', color: COLORS.danger },
  version: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: 16 },
});
