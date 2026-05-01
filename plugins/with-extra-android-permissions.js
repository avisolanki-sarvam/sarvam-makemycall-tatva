/**
 * Custom Expo config plugin — guarantees a fixed set of Android
 * `<uses-permission>` entries land in AndroidManifest.xml on every
 * `expo prebuild`.
 *
 * Why this exists:
 *   The `expo-contacts` plugin is supposed to add READ_CONTACTS/
 *   WRITE_CONTACTS itself, and `app.json -> android.permissions` is
 *   supposed to add the rest. Both pathways have been flaky for us
 *   (plugin chain aborts after an unrelated error, `permissions` array
 *   silently dropped). Result: the manifest ships without READ_CONTACTS,
 *   Android refuses to surface a "Contacts" entry in Settings, and the
 *   in-app contacts picker is permanently stuck on "Permission needed".
 *
 *   Owning the permission additions in a tiny in-repo plugin makes the
 *   manifest deterministic. Idempotent — re-runs of prebuild won't
 *   create duplicates.
 *
 *   Add new permissions to PERMISSIONS below. Don't add ones the user
 *   doesn't actually need (Play Store flags privacy-sensitive permissions
 *   they think you don't use).
 */

const { AndroidConfig } = require('expo/config-plugins');

const PERMISSIONS = [
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.MODIFY_AUDIO_SETTINGS',
];

module.exports = function withExtraAndroidPermissions(config) {
  return AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
};
