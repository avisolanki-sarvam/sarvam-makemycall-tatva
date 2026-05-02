/**
 * PersistentTabBar — the bottom nav that lives across every screen.
 *
 * Why this exists: Expo Router's stock `<Tabs>` only renders its tab bar
 * on screens *inside* the tabs group. The moment the user pushes a
 * screen at the root level (agent creation, campaign wizard, edit
 * profile, etc.) the tabs unmount and the bar disappears. The user
 * loses their persistent home position.
 *
 * The fix: render a single global tab bar at the root layout, position
 * it absolutely at the bottom of the screen, and use `router.replace`
 * (not `push`) when the user taps a tab so we don't pile up history.
 *
 *   - The Tabs navigator inside `(tabs)/_layout.tsx` keeps existing for
 *     the tab routes themselves; we just hide its built-in bar.
 *   - On auth + onboarding screens we return null, so the bar doesn't
 *     bleed into pre-login UX (and the Stack reflows full-height).
 *   - The bar sits as a flex SIBLING of the Stack — not absolute — so
 *     screen content automatically reflows above it without per-screen
 *     padding fixes. When this component returns null the Stack expands
 *     to fill.
 *   - Safe-area math uses `Math.max(insets.bottom, 8)` so the bar never
 *     hides under Android's gesture pill on edge-to-edge devices.
 *   - Active state is detected from `usePathname()` against the four
 *     known tab roots.
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Keyboard } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  HouseIcon,
  UsersIcon,
  MegaphoneIcon,
  GearIcon,
  IconProps,
} from 'phosphor-react-native';
import { useAppTheme } from '../theme/AppThemeProvider';

type TabKey = 'home' | 'contacts' | 'history' | 'settings';

interface TabDef {
  key: TabKey;
  /** i18n key — resolved per-render so language switches re-render the bar. */
  i18nKey: string;
  href:
    | '/(tabs)'
    | '/(tabs)/contacts'
    | '/(tabs)/history'
    | '/(tabs)/settings';
  Icon: React.ComponentType<IconProps>;
}

// Tab definitions — order matters, this is the visual order left → right.
const TABS: TabDef[] = [
  { key: 'home',     i18nKey: 'tabs.home',      href: '/(tabs)',          Icon: HouseIcon },
  { key: 'contacts', i18nKey: 'tabs.customers', href: '/(tabs)/contacts', Icon: UsersIcon },
  { key: 'history',  i18nKey: 'tabs.campaigns', href: '/(tabs)/history',  Icon: MegaphoneIcon },
  { key: 'settings', i18nKey: 'tabs.settings',  href: '/(tabs)/settings', Icon: GearIcon },
];

/**
 * Decide whether the bar should be hidden based on the current route
 * segments. We can't rely on `usePathname()` here because route groups
 * like `(tabs)` are stripped from the visible path — `/(tabs)/index`
 * surfaces as `/`, which is indistinguishable from the pre-auth
 * landing route at `app/index.tsx`. `useSegments()` keeps the group
 * names ('(tabs)', '(auth)', etc.) so we can match them precisely.
 */
export function shouldHideTabBarForSegments(segments: string[]): boolean {
  // No segments → root index.tsx (the auth-state redirect).
  if (segments.length === 0) return true;

  const first = segments[0];

  // Pre-login: any (auth) route.
  if (first === '(auth)') return true;

  // Onboarding before tabs is reachable.
  if (first === 'profile-setup') return true;

  // Anything in the (tabs) group OR a pushed detail screen — show the bar.
  return false;
}

export default function PersistentTabBar() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  // Cast: expo-router's segments type is a tagged union we don't need at
  // runtime; we treat it as plain strings.
  const segments = (useSegments() as unknown as string[]) || [];
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      () => setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Hide on auth + onboarding + while the keyboard is open (typing).
  if (shouldHideTabBarForSegments(segments) || keyboardVisible) return null;

  // Floor the bottom inset so the bar never disappears under a gesture
  // pill on devices that report inset 0 in edge-to-edge mode.
  const bottomPad = Math.max(insets.bottom, 8);

  // Detect the active tab from the segments. Inside (tabs)/, segment[1]
  // is the screen name ("contacts", "history", "settings", or undefined
  // for the index/Home). Outside (tabs)/ — pushed detail / wizard /
  // edit screens — we keep "Home" highlighted so the user knows where
  // back navigation lands.
  const active = detectActiveTabFromSegments(segments);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.borderSecondary,
          paddingBottom: bottomPad,
          height: 60 + bottomPad,
        },
      ]}
      accessibilityRole="tablist"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const tint = isActive ? colors.indigoContent : colors.contentTertiary;
        const label = t(tab.i18nKey);
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (isActive) return; // already there — no-op
              router.replace(tab.href as any);
            }}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
          >
            <tab.Icon size={22} color={tint} weight="regular" />
            <Text style={[styles.label, { color: tint }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function detectActiveTabFromSegments(segments: string[]): TabKey {
  // Inside the (tabs) group, segments look like:
  //   ['(tabs)']                  → Home (index)
  //   ['(tabs)', 'contacts']      → Customers
  //   ['(tabs)', 'history']       → Campaigns
  //   ['(tabs)', 'settings']      → Settings
  //
  // Outside (tabs), pushed detail screens have shapes like:
  //   ['agents', 'new']           → keep Home highlighted
  //   ['agent-preview', '[id]']   → keep Home highlighted
  //   ['campaigns', 'new']        → highlight Campaigns tab
  //   ['campaigns', '[id]']       → highlight Campaigns tab
  //   ['contacts', 'import']      → highlight Customers tab
  //   ['settings', 'edit-profile']→ highlight Settings tab
  if (segments[0] === '(tabs)') {
    const sub = segments[1];
    if (sub === 'contacts') return 'contacts';
    if (sub === 'history') return 'history';
    if (sub === 'settings') return 'settings';
    return 'home';
  }
  if (segments[0] === 'contacts') return 'contacts';
  if (segments[0] === 'campaigns') return 'history';
  if (segments[0] === 'settings') return 'settings';
  // Agent screens originate from Home — keep Home highlighted.
  return 'home';
}

/** Total height of the persistent tab bar including safe-area padding. */
export function tabBarHeight(bottomInset: number): number {
  return 60 + Math.max(bottomInset, 8);
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 6,
    ...Platform.select({
      android: { elevation: 0 },
      ios: { shadowOpacity: 0 },
    }),
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
});
