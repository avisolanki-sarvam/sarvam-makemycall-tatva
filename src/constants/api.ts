import { Platform } from 'react-native';

// Android emulator uses 10.0.2.2 to reach host machine's localhost.
// iOS simulator uses localhost directly. Kept here for the local-backend escape
// hatch — set EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 to override.
const LOCAL_IP = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

const RAILWAY_URL = 'https://sarvam-makemycall-service-production-3699.up.railway.app';

// Resolution order:
//   1. EXPO_PUBLIC_API_URL  — explicit override at start time.
//   2. Default              — the deployed Railway URL, so the dev client and
//                             production builds both hit prod by default.
// To run against a local backend during dev:
//   EXPO_PUBLIC_API_URL=http://${LOCAL_IP}:3000 npx expo start
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || RAILWAY_URL;

// ─── Colour palette ─────────────────────────────────────────────────────────
//
// We migrated from the editorial cream + ink palette to the Tatva token set
// (April 2026 → Tatva fork). To keep this an additive change for the rest
// of the codebase, re-export `COLORS` from `theme.ts` — the named keys are
// preserved (`primary`, `surface`, `ink`, etc.) but they now resolve to
// Tatva-mapped values (white surfaces, near-black brand, indigo accent,
// semantic-state colours).
//
// New screens should import from `./theme` directly so they get the full
// Tatva surface — `TatvaColors`, `Spacing`, `Radius`, `Type`, `Shadow`,
// `StatusToTatva`. Use `COLORS` only as a transitional alias.
export { COLORS } from './theme';
