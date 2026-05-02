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
 * Runtime theme selection lives in `AppThemeProvider`. The compatibility
 * exports below intentionally resolve to dark so any unmigrated call sites
 * keep their previous rendering.
 *
 * Season is loaded as `Fraunces` (free, near-identical editorial
 * serif) via `@expo-google-fonts/fraunces`. Matter falls back to the
 * platform sans-serif (San Francisco / Roboto) — both are excellent
 * neutral grotesks that pair cleanly with Fraunces.
 *
 * Spacing is on a 2px base. So `space(4)` = 8px, `space(8)` = 16px.
 */

import { Platform } from 'react-native';

// ─── Color tokens ─────────────────────────────────────────────────────────
//
// Tatva web switches these semantic tokens through CSS variables. React
// Native cannot consume that mechanism directly, so we keep paired JS maps
// with the same token intent. Both maps mirror Tatva's published neutrals
// and semantic status colors, while the main app brand path stays ink-led.
// The old Indus blue-violet is reserved for auth/login screens only.

export type ThemeScheme = 'light' | 'dark';
export type ThemeMode = ThemeScheme | 'system';

export interface TatvaColorTokens {
  surfacePrimary: string;
  surfaceSecondary: string;
  surfaceTertiary: string;
  backgroundPrimary: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  contentPrimary: string;
  contentSecondary: string;
  contentTertiary: string;
  contentQuaternary: string;
  contentInverse: string;
  borderPrimary: string;
  borderSecondary: string;
  borderTertiary: string;
  brandPrimary: string;
  brandPrimaryHover: string;
  brandSurface: string;
  brandContent: string;
  brandContentInverse: string;
  indigoBackground: string;
  indigoContent: string;
  indigoBorder: string;
  indigoSurface: string;
  indigoSurfaceHover: string;
  saffronStart: string;
  saffronEnd: string;
  positiveBackground: string;
  positiveContent: string;
  positiveBorder: string;
  warningBackground: string;
  warningContent: string;
  warningBorder: string;
  dangerBackground: string;
  dangerContent: string;
  dangerBorder: string;
  orangeBackground: string;
  orangeContent: string;
  greenBackground: string;
  greenContent: string;
  yellowBackground: string;
  yellowContent: string;
  pinkBackground: string;
  pinkContent: string;
  redBackground: string;
  redContent: string;
}

export const TatvaDarkColors = {
  // Surfaces — what cards and the app shell sit on
  surfacePrimary:   '#141414',
  surfaceSecondary: '#1e1e1e',
  surfaceTertiary:  '#242424',

  // Backgrounds — controls (inputs, popovers) sit on these
  backgroundPrimary:   '#242424',
  backgroundSecondary: '#121212',
  backgroundTertiary:  '#343434',

  // Content (text + icons)
  contentPrimary:    '#e4e4e4',
  contentSecondary:  '#949494',
  contentTertiary:   '#646464',
  contentQuaternary: '#424242',
  contentInverse:    '#141414',

  // Borders
  borderPrimary:   '#343434',
  borderSecondary: '#444444',
  borderTertiary:  '#606060',

  // MakeMyCall main app brand path: ink/cream contrast. The blue-violet
  // Indus accent is intentionally scoped to auth screens via AuthAccentColors.
  brandPrimary:        '#e8e8e8',
  brandPrimaryHover:   '#d2d2d2',
  brandSurface:        '#262626',
  brandContent:        '#e8e8e8',
  brandContentInverse: '#141414',

  // Compatibility names only. Keep migrated app chrome neutral.
  indigoBackground:    '#262626',
  indigoContent:       '#949494',
  indigoBorder:        '#444444',
  indigoSurface:       '#e8e8e8',
  indigoSurfaceHover:  '#d2d2d2',

  saffronStart: '#f4a25b',
  saffronEnd:   '#e07a3c',

  positiveBackground: '#0e231b',
  positiveContent:    '#3fb981',
  positiveBorder:     '#1a5234',

  warningBackground: '#271f00',
  warningContent:    '#d29922',
  warningBorder:     '#5e4606',

  dangerBackground: '#2a0c13',
  dangerContent:    '#f85149',
  dangerBorder:     '#6a1c26',

  orangeBackground: '#2d1a0a',
  orangeContent:    '#ea8c48',
  greenBackground:  '#0e281c',
  greenContent:     '#3fb981',
  yellowBackground: '#2a2000',
  yellowContent:    '#d29922',
  pinkBackground:   '#2e1024',
  pinkContent:      '#f06aac',
  redBackground:    '#300e14',
  redContent:       '#f85149',
} as const satisfies TatvaColorTokens;

export const AuthAccentColors = {
  logoTop: '#f4a25b',
  logoBottom: '#a5b4fc',
  buttonStart: '#6366f1',
  buttonEnd: '#818cf8',
  icon: '#f5f5f7',
} as const;

export const TatvaLightColors = {
  // Tatva neutral light tokens.
  surfacePrimary:   '#fafafa',
  surfaceSecondary: '#ffffff',
  surfaceTertiary:  '#f5f5f5',

  backgroundPrimary:   '#ffffff',
  backgroundSecondary: '#f5f5f5',
  backgroundTertiary:  '#f0f0f0',

  contentPrimary:    '#141414',
  contentSecondary:  '#666666',
  contentTertiary:   '#999999',
  contentQuaternary: '#b3b3b3',
  contentInverse:    '#ffffff',

  borderPrimary:   '#f0f0f0',
  borderSecondary: '#e6e6e6',
  borderTertiary:  '#b3b3b3',

  // MakeMyCall brand overrides on top of Tatva neutrals.
  brandPrimary:        '#141414',
  brandPrimaryHover:   '#3d3d3d',
  brandSurface:        '#f0f0f0',
  brandContent:        '#1a1a1a',
  brandContentInverse: '#ffffff',

  // Compatibility names kept for older call sites. These stay neutral/ink
  // rather than Tatva's light-mode blue-indigo scale.
  indigoBackground:    '#f0f0f0',
  indigoContent:       '#1a1a1a',
  indigoBorder:        '#dcdcdc',
  indigoSurface:       '#141414',
  indigoSurfaceHover:  '#3d3d3d',

  saffronStart: '#f4a25b',
  saffronEnd:   '#d76f32',

  positiveBackground: '#f2f8eb',
  positiveContent:    '#6ea335',
  positiveBorder:     '#c8e1b4',

  warningBackground: '#fff8e6',
  warningContent:    '#a27224',
  warningBorder:     '#ffe6af',

  dangerBackground: '#fde7e2',
  dangerContent:    '#b81514',
  dangerBorder:     '#f8d1c6',

  orangeBackground: '#feede6',
  orangeContent:    '#e6651b',
  greenBackground:  '#f2f8eb',
  greenContent:     '#385418',
  yellowBackground: '#fff8e6',
  yellowContent:    '#c08827',
  pinkBackground:   '#fceaf0',
  pinkContent:      '#9d2055',
  redBackground:    '#fde7e2',
  redContent:       '#b81514',
} as const satisfies TatvaColorTokens;

export const TatvaColorSchemes = {
  light: TatvaLightColors,
  dark: TatvaDarkColors,
} as const satisfies Record<ThemeScheme, TatvaColorTokens>;

export function getTatvaColors(scheme: ThemeScheme): TatvaColorTokens {
  return TatvaColorSchemes[scheme];
}

// Backward-compatible default: unmigrated screens remain dark.
export const TatvaColors = TatvaDarkColors;

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
> = createStatusToTatva(TatvaColors);

export function createStatusToTatva(colors: TatvaColorTokens): Record<
  CampaignStatus,
  { bg: string; fg: string; label: string }
> {
  return {
    scheduled:  { bg: colors.backgroundTertiary, fg: colors.contentSecondary, label: 'Scheduled' },
    scheduling: { bg: colors.warningBackground,  fg: colors.warningContent,   label: 'Scheduling' },
    active:     { bg: colors.indigoBackground,   fg: colors.indigoContent,    label: 'Calling' },
    completed:  { bg: colors.positiveBackground, fg: colors.positiveContent,  label: 'Done' },
    failed:     { bg: colors.dangerBackground,   fg: colors.dangerContent,    label: 'Failed' },
    cancelled:  { bg: colors.backgroundTertiary, fg: colors.contentTertiary,  label: 'Cancelled' },
  };
}

// ─── Backwards-compatibility shim ───────────────────────────────────────────
//
// Keeps the prior `COLORS` import working for any screens we haven't
// migrated yet. The exported singleton uses dark tokens by design.
export function createLegacyColors(colors: TatvaColorTokens): Record<string, string> {
  return {
    background:        colors.surfacePrimary,
    surface:           colors.surfaceSecondary,
    cream:             colors.surfacePrimary,
    paper:             colors.surfaceSecondary,

    ink:               colors.brandPrimary,
    inkSoft:           colors.brandPrimaryHover,
    primary:           colors.brandPrimary,
    primaryDark:       colors.brandPrimaryHover,
    primaryLight:      colors.indigoBackground,
    secondary:         colors.brandPrimary,

    text:              colors.contentPrimary,
    textSecondary:     colors.contentSecondary,
    textMuted:         colors.contentTertiary,
    textOnInk:         colors.contentInverse,

    border:            colors.borderSecondary,
    borderSoft:        colors.borderPrimary,

    success:           colors.positiveContent,
    warning:           colors.warningContent,
    danger:            colors.dangerContent,

    statusCommittedBg: colors.positiveBackground,
    // Tatva's light semantic positive text is intentionally soft. The app
    // uses this in 10-12px chips/KPIs, so prefer the same Tatva green scale's
    // higher-contrast content token.
    statusCommittedFg: colors.greenContent,
    statusExtensionBg: colors.warningBackground,
    statusExtensionFg: colors.warningContent,
    statusDeclinedBg:  colors.dangerBackground,
    statusDeclinedFg:  colors.dangerContent,
    statusMuteBg:      colors.backgroundTertiary,
    statusMuteFg:      colors.contentSecondary,
  };
}

export type LegacyColorTokens = ReturnType<typeof createLegacyColors>;

export const COLORS: Record<string, string> = createLegacyColors(TatvaColors);
