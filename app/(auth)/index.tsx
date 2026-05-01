/**
 * /(auth) — entry point.
 *
 * The marketing brochure that used to live here was retired with the
 * Indus refresh: the welcome screen now IS the phone-entry screen at
 * /(auth)/login. There's no longer a separate value-prop page in
 * front of the credential form — the BrandMark + serif headline
 * carry that weight visually.
 */

import { Redirect } from 'expo-router';

export default function AuthIndex() {
  return <Redirect href="/(auth)/login" />;
}
