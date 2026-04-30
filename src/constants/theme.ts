/**
 * Tatva design tokens, mirrored for React Native.
 *
 * Source of truth: https://tatva.sarvam.ai (CSS variables resolved from
 * the Storybook canvas in light mode). RN can't consume Tailwind classes
 * or `Box`/`Text` components directly, so we rebuild the same token names
 * here as plain JS values. Keep names in sync with the web tokens; the
 * web/mobile parity check is "pixel for pixel, name for name".
 *
 * Mental model:
 *   - Surfaces are monochrome white/near-white (cards, panels, page bg).
 *   - Brand is *near-black* (#1a1a1a) — primary CTAs, brand chrome.
 *   - Indigo (#3333cc) is the lone bright accent — used for the brand
 *     mark, active tabs, links, "wallet" pills.
 *   - Positive / warning / danger / orange / pink are the semantic tints
 *     used for status chips and alerts only — never for chrome.
 *
 * Spacing is on a 2px base. So `space(4)` = 8px, `space(8)` = 16px, etc.
 * Use the helper instead of hard-coded numbers in screen styles.
 */

// ─── Color tokens ───────────────────────────────────────────────────────────
//
// Each object groups the related tokens (background + content + border).
// Component code should pull from THESE — never from raw hex strings.

export const TatvaColors = {
  // Surfaces — what cards and the app shell sit on
  surfacePrimary:   '#fafafa',  // page background (warm-neutral white)
  surfaceSecondary: '#ffffff',  // cards, sheets, the elevated layer

  // Backgrounds — controls (inputs, popovers) sit on these
  backgroundPrimary:   '#ffffff',
  backgroundSecondary: '#f5f5f5',
  backgroundTertiary:  '#f0f0f0',

  // Content (text + icons)
  contentPrimary:    '#141414',  // headings, primary copy
  contentSecondary:  '#666666',  // body, descriptions
  contentTertiary:   '#999999',  // metadata, eyebrows, timestamps
  contentQuaternary: '#b3b3b3',  // placeholders, disabled
  contentInverse:    '#ffffff',  // text on dark fills

  // Borders
  borderPrimary:    '#f0f0f0',  // dividers
  borderSecondary:  '#e6e6e6',  // card outlines
  borderTertiary:   '#b3b3b3',  // emphasized borders / focus

  // Brand (Tatva ships a monochrome brand — primary chrome is near-black)
  brandPrimary:        '#1a1a1a',  // primary CTA fill / brand chrome
  brandPrimaryHover:   '#000000',
  brandSurface:        '#f0f0f0',  // soft brand-tinted surface
  brandContent:        '#1a1a1a',  // text on light brand bg
  brandContentInverse: '#ffffff',  // text on the dark brand fill

  // Accent — Indigo. Used for the app logo mark, active tab tint, links,
  // and "wallet credit" style pills. Sparingly!
  indigoBackground: '#e8effc',
  indigoContent:    '#3333cc',
  indigoBorder:     '#3333cc',

  // Semantic states
  positiveBackground: '#f2f8eb',
  positiveContent:    '#385418',
  positiveBorder:     '#6ea335',

  warningBackground: '#fff8e6',
  warningContent:    '#a27224',
  warningBorder:     '#c08827',

  dangerBackground: '#fde7e2',
  dangerContent:    '#b81514',
  dangerBorder:     '#b81514',

  // Extra accents (use only for chart series / category chips)
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
} as const;

// ─── Spacing scale ──────────────────────────────────────────────────────────
//
// Base unit is 2px. Token `n` resolves to `n × 2` px. So:
//   space(2) = 4px   — icon-to-text gap, badge inner padding
//   space(4) = 8px   — button padding, chip gap
//   space(6) = 12px  — input padding, compact card padding
//   space(8) = 16px  — default card padding
//   space(12)= 24px  — section padding
//   space(16)= 32px  — page section padding
export const space = (n: number) => n * 2;

// Alias common steps so consuming code reads naturally.
export const Spacing = {
  '2':  space(2),
  '3':  space(3),
  '4':  space(4),
  '5':  space(5),
  '6':  space(6),
  '8':  space(8),
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
//   md   — buttons, inputs, badges (12)
//   lg   — cards, panels, dropdowns (20)
//   xl   — modals, drawers (24)
//   full — pills, avatars (9999)
export const Radius = {
  sm:   8,
  md:   12,
  lg:   20,
  xl:   24,
  full: 9999,
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────
//
// Tatva ships Season (serif, display + headings) and Matter (sans, body
// + UI). On Android we fall back to the system stack — the app loads
// SpaceGrotesk via expo-font, so we use that for headings and the OS
// sans-serif for body. Names mirror Tatva's `Text` `variant` prop so
// agent prompts reading the spec recognise them.
export const Type = {
  // display
  displaySm:   { fontSize: 32, lineHeight: 38, fontWeight: '500' as const },

  // heading
  headingLg:   { fontSize: 24, lineHeight: 30, fontWeight: '500' as const },
  headingMd:   { fontSize: 20, lineHeight: 26, fontWeight: '500' as const },
  headingSm:   { fontSize: 18, lineHeight: 24, fontWeight: '500' as const },
  headingXs:   { fontSize: 16, lineHeight: 22, fontWeight: '500' as const },

  // body
  bodyXl:      { fontSize: 24, lineHeight: 32, fontWeight: '400' as const },
  bodyLg:      { fontSize: 18, lineHeight: 26, fontWeight: '400' as const },
  bodyMd:      { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodySm:      { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  bodyXs:      { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },

  // labels (uppercase eyebrows, form labels, tag text)
  labelMd:     { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  labelSm:     { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.5 },
} as const;

// ─── Elevation ──────────────────────────────────────────────────────────────
//
// Tatva ships only two shadow tokens. Mirror them as RN style fragments —
// note Android uses `elevation`; iOS uses the shadow* set.
export const Shadow = {
  // l1 — subtle, for dropdowns, tooltips, floating cards
  l1: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  // l2 — strong, for modals, dialogs
  l2: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
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
// migrated yet. Old names point to the closest Tatva equivalent so the
// editorial cream/ink palette is replaced cleanly without a thousand
// edit calls. Note: this object is intentionally NOT `as const` — code
// like `let dot = COLORS.textMuted` then `dot = COLORS.danger` would
// fail to compile under literal types, since each key would resolve to
// its specific hex string. Keeping it as a wide `Record`-like shape
// preserves the prior assignment ergonomics.
export const COLORS: Record<string, string> = {
  background:        TatvaColors.surfacePrimary,
  surface:           TatvaColors.surfaceSecondary,
  cream:             TatvaColors.surfacePrimary,
  paper:             TatvaColors.surfaceSecondary,

  ink:               TatvaColors.brandPrimary,
  inkSoft:           '#2a2a2a',
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
