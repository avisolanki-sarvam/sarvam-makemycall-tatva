import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { COLORS } from '../../src/constants/api';

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => logout() },
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
        {/* Re-uses the FTUX screen as a "re-onboard / author another agent"
            flow. Tapping creates a NEW agent + overwrites businessDesc on
            the User row. Until a dedicated edit-profile screen lands, this
            is the only path back into agent authoring from the home tabs. */}
        <MenuItem label="Author another agent" icon="✏️" onPress={() => router.push('/profile-setup')} />
        <MenuItem label="Credit History" icon="💳" />
        <MenuItem label="Notification Preferences" icon="🔔" />
        <MenuItem label="Help & Support" icon="❓" />
        <MenuItem label="About MakeMyCall" icon="ℹ️" />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
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
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 26, fontWeight: '700', color: COLORS.primary },
  profileName: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  profilePhone: { fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
  businessName: { fontSize: 14, color: COLORS.primary, fontWeight: '600', marginTop: 4 },

  menu: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  menuIcon: { fontSize: 18 },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: COLORS.text },
  menuLabelStub: { color: COLORS.textMuted, fontWeight: '400' },
  menuArrow: { fontSize: 20, color: COLORS.textMuted },

  logoutBtn: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    alignItems: 'center',
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: COLORS.danger },
  version: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: 16 },
});
