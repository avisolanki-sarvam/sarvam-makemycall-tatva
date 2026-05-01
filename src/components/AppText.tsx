/**
 * AppText — Tatva `Text` primitive, ported to React Native.
 *
 * Tatva's Text on web is polymorphic (`as="h1" | "p" | "label" | …`) and
 * takes `variant` + `tone`. React Native only has the single `Text`
 * element so we drop `as` and keep `variant` (size + weight from the
 * type scale) + `tone` (semantic color) — both optional.
 *
 * Why a wrapper instead of inline styles per screen: it gives the rest
 * of the app a single place to enforce the type + tone tokens. Screens
 * read like the Tatva spec (`<AppText variant="heading-md" tone="secondary">`).
 *
 * Naming: we call it `AppText` rather than `Text` to avoid the trivial
 * import-name collision with `react-native`'s `Text` — RN's auto-import
 * is everywhere in this codebase.
 */

import { Text as RNText, TextProps as RNTextProps, StyleSheet, TextStyle } from 'react-native';
import { TatvaColors, Type } from '../constants/theme';

export type TextVariant =
  | 'display-lg'
  | 'display-md'
  | 'display-sm'
  | 'heading-lg'
  | 'heading-md'
  | 'heading-sm'
  | 'heading-xs'
  | 'body-xl'
  | 'body-lg'
  | 'body-md'
  | 'body-sm'
  | 'body-xs'
  | 'label-md'
  | 'label-sm'
  | 'numeral-lg'
  | 'numeral-md';

export type TextTone =
  | 'default'
  | 'secondary'
  | 'tertiary'
  | 'quaternary'
  | 'inverse'
  | 'brand'
  | 'positive'
  | 'warning'
  | 'danger'
  | 'indigo';

export interface AppTextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: 'left' | 'center' | 'right';
  numberOfLines?: number;
}

const VARIANT_TO_STYLE: Record<TextVariant, TextStyle> = {
  'display-lg': Type.displayLg,
  'display-md': Type.displayMd,
  'display-sm': Type.displaySm,
  'heading-lg': Type.headingLg,
  'heading-md': Type.headingMd,
  'heading-sm': Type.headingSm,
  'heading-xs': Type.headingXs,
  'body-xl':    Type.bodyXl,
  'body-lg':    Type.bodyLg,
  'body-md':    Type.bodyMd,
  'body-sm':    Type.bodySm,
  'body-xs':    Type.bodyXs,
  'label-md':   Type.labelMd,
  'label-sm':   Type.labelSm,
  'numeral-lg': Type.numeralLg,
  'numeral-md': Type.numeralMd,
};

const TONE_TO_COLOR: Record<TextTone, string> = {
  default:    TatvaColors.contentPrimary,
  secondary:  TatvaColors.contentSecondary,
  tertiary:   TatvaColors.contentTertiary,
  quaternary: TatvaColors.contentQuaternary,
  inverse:    TatvaColors.contentInverse,
  brand:      TatvaColors.brandPrimary,
  positive:   TatvaColors.positiveContent,
  warning:    TatvaColors.warningContent,
  danger:     TatvaColors.dangerContent,
  indigo:     TatvaColors.indigoContent,
};

export function AppText({
  variant = 'body-md',
  tone = 'default',
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  return (
    <RNText
      style={StyleSheet.flatten([
        VARIANT_TO_STYLE[variant],
        { color: TONE_TO_COLOR[tone] },
        align ? { textAlign: align } : null,
        style,
      ])}
      {...rest}
    >
      {children}
    </RNText>
  );
}
