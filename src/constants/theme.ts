/**
 * Tatva design tokens, mirrored for React Native (DARK by default).
 *
 * Source of truth: https://tatva.sarvam.ai (Storybook canvas) + the
 * Tatva MCP component docs. Tatva ships two typefaces (Season — serif,
 * display + headings; Matter — sans, body + UI) and a paired light/dark
 * token set switched by a `.dark` class on web. RN can't consume the
 * Tailwind/CSS-variable mechanism directly, so we reimplement the same
 * names as JS values.
 *
 * **This app defaults to DARK** to match the Indus aesthetic — that's
 * the cinematic onboarding flow, the "What's on your mind?" home, and
 * the chat surfaces. All token getters resolve to dark values; a
 * future light-mode pass would expose a paired token map and a
 * `useTheme()` hook reading useColorScheme().
 *
 * Season is loaded as `Fraunces` (free, near-identical editorial
 * serif) via `@expo-google-fonts/fraunces`. Matter falls back to the
 * platform sans-serif (San Francisco / Roboto) — both are excellent
 * neutral grotesks that pair cleanly with Fraunces.
 *
 * Spacing is on a 2px base. So `space(4)` = 8px, `space(8)` = 16px.
 */

import { Platform } from 'react-native';

// ─── Color tokens (DARK) ─────────────────────────────────────────────────
//
// Each object groups the related tokens (background + content + border).
// Component code should pull from THESE — never from raw hex strings.
//
// Values come from the Tatva theming docs (`.dark` token table) plus
// the Indus signature additions (saturated-indigo brand-primary,
// brand-secondary for the gradient action buttons).

export const TatvaColors = {
  // Surfaces — what cards and the app shell sit on
  surfacePrimary:   '#0e0e10',  // app shell, page background (true near-black)
  surfaceSecondary: '#1a1a1d',  // cards, sheets, the elevated layer
  surfaceTertiary:  '#242428',  // raised tile, input fill, pressed state

  // Backgrounds — controls (inputs, popovers) sit on these
  backgroundPrimary:   '#1a1a1d',
  backgroundSecondary: '#242428',
  backgroundTertiary:  '#2e2e34',

  // Content (text + icons)
  contentPrimary:    '#f5f5f7',  // headings, primary copy
  contentSecondary:  '#a8a8b3',  // body, descriptions
  contentTertiary:   '#7a7a85',  // metadata, eyebrows, timestamps
  contentQuaternary: '#5a5a65',  // placeholders, disabled
  contentInverse:    '#0e0e10',  // text on light fills (rare in dark mode)

  // Borders — these have to read clearly on the dark surfaces.
  borderPrimary:    '#2a2a30',  // dividers
  borderSecondary:  '#343438',  // card outlines (default)
  borderTertiary:   '#5a5a65',  // emphasized borders / focus

  // Brand — Tatva's `brand-primary` token. Soft violet-indigo, the
  // Indus signature. Used for primary CTAs, the action sphere on the
  // chat input, focus halos, the medallion on the home tile.
  brandPrimary:        '#818cf8',  // dark-mode brand-primary (Tatva spec)
  brandPrimaryHover:   '#a5b4fc',
  brandSurface:        '#1f1d3a',  // soft brand-tinted surface
  brandContent:        '#c7d2fe',  // brand text on a dark surface
  brandContentInverse: '#0e0e10',  // on a brand-primary fill

  // Indigo accent — the saturated link / focus indigo.
  // Distinct from brand-primary: this is the "link blue" of Indus.
  indigoBackground: '#1a1f3a',  // soft tint
  indigoContent:    '#a5b4fc',  // on dark surface
  indigoBorder:     '#6366f1',
  indigoSurface:    '#6366f1',  // saturated tile
  indigoSurfaceHover: '#818cf8',

  // Saffron / sunrise — Indus's brand mark gradient top half.
  saffronStart: '#f4a25b',
  saffronEnd:   '#e07a3c',

  // Semantic states (dark-tuned)
  positiveBackground: '#0f2d18',
  positiveContent:    '#86efac',
  positiveBorder:     '#16a34a',

  warningBackground: '#2d2410',
  warningContent:    '#fcd34d',
  warningBorder:     '#d97706',

  dangerBackground: '#2d1014',
  dangerContent:    '#fca5a5',
  dangerBorder:     '#ef4444',

  // Extra accents (chart / category chips)
  orangeBackground: '#2d1f10',
  orangeContent:    '#fb923c',
  greenBackground:  '#0f2d18',
  greenContent:     '#86efac',
  yellowBackground: '#2d2410',
  yellowContent:    '#fcd34d',
  pinkBackground:   '#2d1024',
  pinkContent:      '#f9a8d4',
  redBackground:    '#2d1014',
  redContent:       '#fca5a5',
} as const;

// ─── Spacing scale ──────────────────────────────────────────────────────────
//
// Base unit is 2px. Token `n` resolves to `n × 2` px.
//   space(2) = 4px   — icon-to-text gap, badge inner padding
//   space(4) = 8px   — button padding, chip gap
//   space(6) = 12px  — input padding (compact)
//   space(8) = 16px  — default card padding
//   space(12)= 24px  — section padding
//   space(16)= 32px  — page section padding
export const space = (n: number) => n * 2;

export const Spacing = {
  '1':  space(1),
  '2':  space(2),
  '3':  space(3),
  '4':  space(4),
  '5':  space(5),
  '6':  space(6),
  '7':  space(7),
  '8':  space(8),
  '9':  space(9),
  '10': space(10),
  '12': space(12),
  '14': space(14),
  '16': space(16),
  '20': space(20),
  '24': space(24),
} as const;

// ─── Border radius ──────────────────────────────────────────────────────────
//
// Surface guidance:
//   sm   — tags, table cells (8)
//   md   — buttons, inputs in dense forms (12)
//   lg   — cards, panels, dropdowns (20)
//   xl   — modals, drawers, hero tiles (24)
//   full — pills (Indus default for inputs + suggestion chips)
export const Radius = {
  sm:   8,
  md:   12,
  lg:   20,
  xl:   24,
  full: 9999,
} as const;

// ─── Font weights ───────────────────────────────────────────────────────────
//
// Tatva's label-md uses regular weight (`font-[400]`). Headings 500.
// Display uses 500 (Season is high-contrast enough that 500 reads as
// "display"). Centralise these so we don't drift.
export const Weight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
};

// ─── Font families ──────────────────────────────────────────────────────────
//
// `Fonts.serif` is loaded via @expo-google-fonts/fraunces; the names below
// MUST exactly match the keys passed to useFonts() in app/_layout.tsx.
// `Fonts.sans` falls back to the platform default — which is perfect for
// Matter's role on a phone.
//
// Per Tatva's Typography docs:
//   - display-* and heading-* (except heading-sm) use Season
//   - heading-sm + body-* + label-* use Matter (sans)

export const Fonts = {
  serifRegular: 'Fraunces_400Regular',
  serifMedium:  'Fraunces_500Medium',
  // Matter substitute = platform sans. RN resolves `undefined` to the
  // system stack — that's what we want.
  sansRegular:  Platform.select({ ios: undefined, android: 'sans-serif' }),
  sansMedium:   Platform.select({ ios: undefined, android: 'sans-serif-medium' }),
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────
//
// `letterSpacing` matches Tatva's `tracking-tight` for display + heading.
// label-md uses regular weight per the Tatva docs (do not bump to medium).
//
// The display + heading-{lg,md,xs} variants use the serif. heading-sm,
// body-*, label-* stay sans — exact match to Tatva's typeface table.
export const Type = {
  // display — hero titles (splash, "Welcome to Sarvam", "What's on your mind?")
  displayLg:   { fontFamily: Fonts.serifMedium,  fontSize: 40, lineHeight: 46, fontWeight: Weight.medium, letterSpacing: -0.6 },
  displayMd:   { fontFamily: Fonts.serifMedium,  fontSize: 34, lineHeight: 40, fontWeight: Weight.medium, letterSpacing: -0.5 },
  displaySm:   { fontFamily: Fonts.serifMedium,  fontSize: 28, lineHeight: 34, fontWeight: Weight.medium, letterSpacing: -0.4 },

  // heading — Season except heading-sm (Tatva spec)
  headingLg:   { fontFamily: Fonts.serifMedium,  fontSize: 24, lineHeight: 30, fontWeight: Weight.medium, letterSpacing: -0.3 },
  headingMd:   { fontFamily: Fonts.serifMedium,  fontSize: 20, lineHeight: 26, fontWeight: Weight.medium, letterSpacing: -0.2 },
  headingSm:   { fontFamily: Fonts.sansMedium,   fontSize: 18, lineHeight: 24, fontWeight: Weight.medium },
  headingXs:   { fontFamily: Fonts.serifMedium,  fontSize: 16, lineHeight: 22, fontWeight: Weight.medium },

  // body — Matter (sans) throughout
  bodyXl:      { fontFamily: Fonts.sansRegular,  fontSize: 24, lineHeight: 32, fontWeight: Weight.regular },
  bodyLg:      { fontFamily: Fonts.sansRegular,  fontSize: 18, lineHeight: 26, fontWeight: Weight.regular },
  bodyMd:      { fontFamily: Fonts.sansRegular,  fontSize: 16, lineHeight: 22, fontWeight: Weight.regular },
  bodySm:      { fontFamily: Fonts.sansRegular,  fontSize: 14, lineHeight: 20, fontWeight: Weight.regular },
  bodyXs:      { fontFamily: Fonts.sansRegular,  fontSize: 12, lineHeight: 16, fontWeight: Weight.regular },

  // labels — Matter, label-md REGULAR per Tatva spec
  labelMd:     { fontFamily: Fonts.sansRegular,  fontSize: 14, lineHeight: 20, fontWeight: Weight.regular },
  labelSm:     { fontFamily: Fonts.sansMedium,   fontSize: 12, lineHeight: 16, fontWeight: Weight.medium, letterSpacing: 0.3 },

  // numerals — Season for the splash KPI moments
  numeralLg:   { fontFamily: Fonts.serifMedium,  fontSize: 36, lineHeight: 40, fontWeight: Weight.semibold, letterSpacing: -0.5 },
  numeralMd:   { fontFamily: Fonts.serifMedium,  fontSize: 26, lineHeight: 30, fontWeight: Weight.semibold, letterSpacing: -0.3 },
} as const;

// ─── Elevation ──────────────────────────────────────────────────────────────
//
// Shadows on dark surfaces are mostly imperceptible — Indus relies on
// border + tonal contrast instead. We keep l1/l2 as no-op-friendly
// objects so calling code doesn't have to special-case dark.
export const Shadow = {
  l1: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.4,
      shadowRadius: 3,
    },
    android: { elevation: 2 },
    default: {},
  }) as object,
  l2: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 24,
    },
    android: { elevation: 8 },
    default: {},
  }) as object,
} as const;

// ─── Status helpers ─────────────────────────────────────────────────────────
//
// Map the campaign / call status enum to the Tatva semantic colour pair.
// Keep the labels Hinglish-flat — this is the consumer-visible string.
export type CampaignStatus =
  | 'scheduled'
  | 'scheduling'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const StatusToTatva: Record<
  CampaignStatus,
  { bg: string; fg: string; label: string }
> = {
  scheduled:  { bg: TatvaColors.backgroundTertiary, fg: TatvaColors.contentSecondary, label: 'Scheduled' },
  scheduling: { bg: TatvaColors.warningBackground,  fg: TatvaColors.warningContent,   label: 'Scheduling' },
  active:     { bg: TatvaColors.indigoBackground,   fg: TatvaColors.indigoContent,    label: 'Calling' },
  completed:  { bg: TatvaColors.positiveBackground, fg: TatvaColors.positiveContent,  label: 'Done' },
  failed:     { bg: TatvaColors.dangerBackground,   fg: TatvaColors.dangerContent,    label: 'Failed' },
  cancelled:  { bg: TatvaColors.backgroundTertiary, fg: TatvaColors.contentTertiary,  label: 'Cancelled' },
};

// ─── Backwards-compatibility shim ───────────────────────────────────────────
//
// Keeps the prior `COLORS` import working for any screens we haven't
// migrated yet. With dark-mode tokens above, any unmigrated screen
// flips to dark automatically — that's intentional.
export const COLORS: Record<string, string> = {
  background:        TatvaColors.surfacePrimary,
  surface:           TatvaColors.surfaceSecondary,
  cream:             TatvaColors.surfacePrimary,
  paper:             TatvaColors.surfaceSecondary,

  ink:               TatvaColors.brandPrimary,
  inkSoft:           TatvaColors.brandPrimaryHover,
  primary:           TatvaColors.brandPrimary,
  primaryDark:       TatvaColors.brandPrimaryHover,
  primaryLight:      TatvaColors.indigoBackground,
  secondary:         TatvaColors.brandPrimary,

  text:              TatvaColors.contentPrimary,
  textSecondary:     TatvaColors.contentSecondary,
  textMuted:         TatvaColors.contentTertiary,
  textOnInk:         TatvaColors.contentInverse,

  border:            TatvaColors.borderSecondary,
  borderSoft:        TatvaColors.borderPrimary,

  success:           TatvaColors.positiveContent,
  warning:           TatvaColors.warningContent,
  danger:            TatvaColors.dangerContent,

  statusCommittedBg: TatvaColors.positiveBackground,
  statusCommittedFg: TatvaColors.positiveContent,
  statusExtensionBg: TatvaColors.warningBackground,
  statusExtensionFg: TatvaColors.warningContent,
  statusDeclinedBg:  TatvaColors.dangerBackground,
  statusDeclinedFg:  TatvaColors.dangerContent,
  statusMuteBg:      TatvaColors.backgroundTertiary,
  statusMuteFg:      TatvaColors.contentSecondary,
};
