/**
 * Phone-book import via expo-contacts.
 *
 * Native module is lazy-loaded with a probe call (same pattern as
 * authStore's expo-secure-store handling) so a dev-client that hasn't been
 * rebuilt against expo-contacts yet doesn't crash on import — instead the
 * caller gets a clean { ok: false, reason } and can show a useful message.
 */

export interface DeviceContact {
  /** Stable id from the device contacts DB — only used for selection state. */
  id: string;
  name: string;
  /** Digits-only, no country code. /contacts/bulk dedupes on `(user_id, phone)`. */
  phone: string;
}

type ContactsModule = {
  requestPermissionsAsync: () => Promise<ContactPermissionResponse>;
  getPermissionsAsync: () => Promise<ContactPermissionResponse>;
  getContactsAsync: (opts?: any) => Promise<{ data: any[] }>;
  Fields: { Name: string; PhoneNumbers: string };
};

type ContactPermissionResponse = {
  status?: 'granted' | 'denied' | 'undetermined';
  granted?: boolean;
  canAskAgain?: boolean;
};

let _mod: ContactsModule | null | undefined;

function hasContactsPermission(permission: ContactPermissionResponse | null | undefined): boolean {
  return permission?.granted === true || permission?.status === 'granted';
}

async function getModule(): Promise<ContactsModule | null> {
  if (_mod !== undefined) return _mod;
  try {
    const m = await import('expo-contacts');
    // Smoke-test the native bridge: getPermissionsAsync is the cheapest call.
    // If the native module isn't linked, this throws.
    await m.getPermissionsAsync();
    _mod = m as unknown as ContactsModule;
  } catch (err) {
    console.warn('[contactImport] expo-contacts unavailable:', err);
    _mod = null;
  }
  return _mod;
}

export type LoadResult =
  | { ok: true; contacts: DeviceContact[] }
  | { ok: false; reason: 'unavailable' | 'denied'; message: string };

/**
 * Read all phone-bearing device contacts, requesting permission only when
 * Android/iOS says we do not already have it.
 * Normalises to { id, name, phone } and dedupes by phone within the device.
 */
export async function loadDeviceContacts(): Promise<LoadResult> {
  const mod = await getModule();
  if (!mod) {
    return {
      ok: false,
      reason: 'unavailable',
      message:
        'Phone-book access needs a dev-client rebuild. Run `npx expo run:android` (or your EAS dev build) once and try again.',
    };
  }

  const existingPermission = await mod.getPermissionsAsync();
  const permission = hasContactsPermission(existingPermission)
    ? existingPermission
    : await mod.requestPermissionsAsync();

  if (!hasContactsPermission(permission)) {
    return {
      ok: false,
      reason: 'denied',
      message: 'MakeMyCall needs permission to read your contacts. You can enable it in system settings.',
    };
  }

  const { data } = await mod.getContactsAsync({
    fields: [mod.Fields.Name, mod.Fields.PhoneNumbers],
  });

  const seen = new Set<string>();
  const out: DeviceContact[] = [];
  for (const c of data) {
    const name: string | undefined = c.name || c.firstName || c.lastName;
    const phones: any[] = c.phoneNumbers || [];
    if (!name || phones.length === 0) continue;
    // Use the first phone number with a digit. Strip non-digits.
    const raw = phones[0]?.number || phones[0]?.digits;
    if (!raw) continue;
    const phone = String(raw).replace(/\D/g, '');
    if (phone.length < 10) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    out.push({ id: String(c.id || phone), name: name.trim(), phone });
  }

  // Sort by name (case-insensitive) so the picker is scannable.
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { ok: true, contacts: out };
}
