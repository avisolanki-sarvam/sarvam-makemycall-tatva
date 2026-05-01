/**
 * Push / local notifications wrapper.
 *
 * Native module is lazy-loaded with the same probe pattern as contactImport,
 * so a dev-client that hasn't been rebuilt against expo-notifications doesn't
 * crash on import — the caller just gets a clean { ok: false, reason }.
 */

import { Platform } from 'react-native';

type NotifModule = {
  requestPermissionsAsync: (
    opts?: any,
  ) => Promise<{ status: 'granted' | 'denied' | 'undetermined'; granted: boolean }>;
  getPermissionsAsync: () => Promise<{ status: 'granted' | 'denied' | 'undetermined' }>;
  setNotificationChannelAsync?: (channelId: string, channel: any) => Promise<any>;
  AndroidImportance?: { DEFAULT: number; HIGH: number };
};

let _mod: NotifModule | null | undefined;

async function getModule(): Promise<NotifModule | null> {
  if (_mod !== undefined) return _mod;
  try {
    const m = await import('expo-notifications');
    // Probe: cheapest call. Throws if native bridge isn't linked.
    await m.getPermissionsAsync();
    _mod = m as unknown as NotifModule;
  } catch (err) {
    console.warn('[notifications] expo-notifications unavailable:', err);
    _mod = null;
  }
  return _mod;
}

export type NotifResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'denied'; message: string };

/**
 * Request notification permissions. On Android 13+ this triggers the
 * runtime POST_NOTIFICATIONS dialog (which is what makes the toggle
 * appear in Settings → Apps → MakeMyCall → Notifications).
 *
 * Call this once during onboarding or before scheduling the first notification.
 */
export async function ensureNotificationPermission(): Promise<NotifResult> {
  const mod = await getModule();
  if (!mod) {
    return {
      ok: false,
      reason: 'unavailable',
      message:
        'Notifications need a dev-client rebuild. Run `npx expo run:android` once and try again.',
    };
  }

  // Set up the default Android channel before requesting — otherwise
  // notifications can't be delivered even after permission is granted.
  if (Platform.OS === 'android' && mod.setNotificationChannelAsync && mod.AndroidImportance) {
    await mod.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: mod.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const existing = await mod.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const req = await mod.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    status = req.status;
  }

  if (status !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      message:
        'MakeMyCall needs permission to send you notifications. You can enable it in system settings.',
    };
  }

  return { ok: true };
}
