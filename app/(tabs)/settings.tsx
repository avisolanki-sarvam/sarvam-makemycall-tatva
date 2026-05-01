/**
 * /(tabs)/settings — Settings screen (Tatva fork, restrained edition).
 *
 * Layout (CollectPay parity):
 *
 *   1. Header        — brand "M" tile + "Settings".
 *
 *   2. Profile card  — avatar (indigo), name, phone. That's it. No
 *                      business name in the card — it lives in its own
 *                      Business profile row below for editability.
 *
 *   3. BUSINESS      — single row: small neutral icon + "Business name"
 *      DETAILS         label on top, "Prince Hostel" value below + chevron.
 *
 *   4. AGENT &       — three rows, same label/value pattern. Only the
 *      REMINDERS       WhatsApp row gets a green icon (brand convention,
 *                      everyone recognises it). The rest are monochrome.
 *
 *   5. ACCOUNT       — credit history, notifications, help, about. All
 *                      monochrome icons.
 *
 *   6. Log out       — bottom destructive button.
 */

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  StorefrontIcon,
  UsersIcon,
  WhatsappLogoIcon,
  TranslateIcon,
  WalletIcon,
  BellIcon,
  QuestionIcon,
  InfoIcon,
  SignOutIcon,
  CaretRightIcon,
  IconProps,
} from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../src/stores/authStore';
import { TatvaColors, Radius, Type } from '../../src/constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert(t('common.logOut'), t('common.logOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.logOut'),
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)');
        },
      },
    ]);
  };

  const initials = (user?.name || user?.phone || '?').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={TatvaColors.surfaceSecondary} />

      {/* ─── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.brandTile}>
            <Text style={styles.brandTileText}>M</Text>
          </View>
          <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ─── Profile card ──────────────────────────────────── */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.name || t('settings.user')}
            </Text>
            <Text style={styles.profilePhone}>+91 {user?.phone}</Text>
          </View>
        </View>

        {/* ─── Business details ─────────────────────────────── */}
        <SectionLabel>{t('settings.sections.businessDetails')}</SectionLabel>
        <Group>
          <Row
            Icon={StorefrontIcon}
            label={t('settings.rows.businessName')}
            value={user?.businessName || t('settings.rows.businessNamePlaceholder')}
            onPress={() => router.push('/settings/edit-profile')}
          />
        </Group>

        {/* ─── Agent & reminders ────────────────────────────── */}
        <SectionLabel>{t('settings.sections.agentReminders')}</SectionLabel>
        <Group>
          <Row
            Icon={UsersIcon}
            label={t('settings.rows.manageAgents')}
            value={t('settings.rows.manageAgentsValue')}
            onPress={() => router.push('/agents')}
          />
          <Row
            Icon={TranslateIcon}
            label={t('settings.rows.defaultLanguage')}
            value={t(`language.options.${user?.language || 'hi'}`)}
            onPress={() => router.push('/settings/language')}
            isLast
          />
        </Group>

        {/* ─── Account ──────────────────────────────────────── */}
        <SectionLabel>{t('settings.sections.account')}</SectionLabel>
        {/* <Group>
          <Row Icon={WalletIcon}    label={t('settings.rows.creditHistory')} /> 
          <Row Icon={BellIcon}      label={t('settings.rows.notifications')} />
          <Row Icon={QuestionIcon}  label={t('settings.rows.helpSupport')} />
          <Row Icon={InfoIcon}      label={t('settings.rows.about')}          isLast />
        </Group> */}

        {/* ─── Log out ──────────────────────────────────────── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <SignOutIcon size={16} color={TatvaColors.dangerContent} weight="regular" />
          <Text style={styles.logoutText}>{t('common.logOut')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>{t('common.version')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function Group({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

type IconCmp = React.ComponentType<IconProps>;

/**
 * Settings row — label on top, optional value below (CollectPay's
 * "Business Name / Prince Hostel" pattern).
 *
 * Icon defaults to monochrome (`content-secondary` on a neutral bg). Pass
 * `iconAccent` + `iconBgAccent` to opt into a coloured tile — used only for
 * the WhatsApp row, where the green is universally recognised.
 */
function Row({
  Icon,
  label,
  value,
  onPress,
  isLast,
  iconAccent,
  iconBgAccent,
}: {
  Icon: IconCmp;
  label: string;
  value?: string;
  onPress?: () => void;
  isLast?: boolean;
  iconAccent?: string;
  iconBgAccent?: string;
}) {
  const isStub = !onPress;
  const fg = iconAccent ?? TatvaColors.contentSecondary;
  const bg = iconBgAccent ?? TatvaColors.backgroundSecondary;
  const borderColor = iconBgAccent ? 'transparent' : TatvaColors.borderSecondary;

  // Stub rows still feel tappable (active opacity, no `disabled`) but we
  // surface their state with a "Soon" pill instead of a chevron, so the
  // user can tell at a glance which entries are wired vs. coming.
  return (
    <TouchableOpacity
      style={[styles.row, !isLast && styles.rowBorder]}
      onPress={onPress ?? undefined}
      activeOpacity={0.6}
    >
      <View style={[styles.rowIcon, { backgroundColor: bg, borderColor, borderWidth: 1 }]}>
        <Icon size={16} color={fg} weight="regular" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowLabel, isStub && styles.rowLabelStub]} numberOfLines={1}>
          {label}
        </Text>
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
        ) : null}
      </View>
      {isStub ? <SoonPill /> : <CaretRightIcon size={16} color={TatvaColors.contentTertiary} weight="regular" />}
    </TouchableOpacity>
  );
}

// Small i18n-aware "Soon" pill used in place of a chevron on stub rows.
function SoonPill() {
  const { t } = useTranslation();
  return (
    <View style={styles.soonPill}>
      <Text style={styles.soonPillText}>{t('common.soon')}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TatvaColors.surfacePrimary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: TatvaColors.borderSecondary,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTile: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: TatvaColors.indigoContent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTileText: {
    color: TatvaColors.contentInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TatvaColors.contentPrimary,
  },

  scrollContent: { padding: 16, paddingBottom: 32 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    padding: 16,
    marginBottom: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.indigoContent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: TatvaColors.contentInverse,
    fontSize: 16,
    fontWeight: '700',
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: TatvaColors.contentPrimary,
  },
  profilePhone: {
    fontSize: 13,
    color: TatvaColors.contentSecondary,
    marginTop: 2,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: TatvaColors.contentTertiary,
    paddingHorizontal: 4,
    marginTop: 8,
    marginBottom: 8,
    letterSpacing: 0.6,
  },
  group: {
    backgroundColor: TatvaColors.surfaceSecondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    overflow: 'hidden',
    marginBottom: 6,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: TatvaColors.borderPrimary,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: TatvaColors.contentPrimary,
  },
  rowLabelStub: { color: TatvaColors.contentSecondary },
  rowValue: {
    fontSize: 12,
    color: TatvaColors.contentTertiary,
    marginTop: 2,
  },
  // ─── "Soon" pill ─ shown on rows whose backend isn't wired yet ───
  soonPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: TatvaColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
  },
  soonPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: TatvaColors.contentTertiary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: TatvaColors.borderSecondary,
    backgroundColor: TatvaColors.surfaceSecondary,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
    color: TatvaColors.dangerContent,
  },

  version: {
    fontSize: 11,
    color: TatvaColors.contentQuaternary,
    textAlign: 'center',
    marginTop: 14,
  },
});
