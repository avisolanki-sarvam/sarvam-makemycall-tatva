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

/**
 * Editorial cream + ink black palette (April 2026 mockups).
 * No indigo / blue / purple. Status accents use sage / tan / rust / mute.
 *
 * Property names are kept for backwards compatibility with existing screens
 * (`primary`, `primaryLight`, `success`, `warning`, `danger`). Use the
 * semantic aliases (`ink`, `cream`, `paper`, etc.) for new code.
 */
export const COLORS = {
  // Surfaces
  background: '#faf6ed',   // warm cream — page background
  surface: '#fffdf6',      // paper — cards
  cream: '#faf6ed',
  paper: '#fffdf6',

  // Ink / primary action
  ink: '#1a1a1a',
  inkSoft: '#2a2a2a',
  primary: '#1a1a1a',           // alias — was indigo
  primaryDark: '#000000',
  primaryLight: '#f0e8d6',      // soft cream tint, used as active/hover bg
  secondary: '#1a1a1a',         // we don't use a second brand colour anymore

  // Text
  text: '#1a1a1a',
  textSecondary: '#6b6155',    // warm gray
  textMuted: '#8b8170',        // warmer gray
  textOnInk: '#faf6ed',        // text colour on dark buttons

  // Borders
  border: '#e8e0d0',           // warm border
  borderSoft: '#f0e8d6',

  // Status — bg + text pairs are exposed as separate keys
  // Old aliases (success/warning/danger) point to text colours so existing
  // screens keep working; status chips should use the explicit pairs.
  success: '#3d4a2c',          // sage — committed
  warning: '#7c5a2a',           // tan — extension
  danger:  '#8b3e1d',           // rust — declined

  statusCommittedBg:  '#dde6cd',
  statusCommittedFg:  '#3d4a2c',
  statusExtensionBg:  '#f0e2c7',
  statusExtensionFg:  '#7c5a2a',
  statusDeclinedBg:   '#f3dccd',
  statusDeclinedFg:   '#8b3e1d',
  statusMuteBg:       '#ece5d4',
  statusMuteFg:       '#6b6155',
};
