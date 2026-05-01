/**
 * Button — Tatva `Button` primitive, ported to React Native.
 *
 * Mirrors the Tatva button spec from the MCP docs:
 *   variant: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'inverse' | 'indigo'
 *   size:    'sm' | 'md' | 'lg'   (heights: 32 / 40 / 48)
 *   width:   'full' | 'fit'
 *   isLoading, icon (left/right), iconPosition
 *
 * Note we add a Tatva-extension `'indigo'` variant for the Indus signature
 * surface — the saturated indigo CTA used on the onboarding hero. Tatva
 * web doesn't ship this one out-of-box; Indus pulls it in via the brand
 * surface utility. We expose it as a first-class variant so screens stay
 * declarative.
 */

import { ReactNode } from 'react';
import {
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { TatvaColors, Radius, Spacing, Weight } from '../constants/theme';
import { AppText } from './AppText';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'inverse'
  | 'indigo';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 'full' = stretch to container width. */
  width?: 'full' | 'fit';
  isLoading?: boolean;
  disabled?: boolean;
  /** Optional left or right icon node (e.g. a Phosphor icon). */
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const SIZE_HEIGHT: Record<ButtonSize, number> = { sm: 32, md: 40, lg: 48 };
const SIZE_PADDING: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 20 };
const SIZE_FONT: Record<ButtonSize, number> = { sm: 13, md: 14, lg: 15 };

interface VariantTokens {
  bg: string;
  fg: string;
  border?: string;
}

const VARIANTS: Record<ButtonVariant, VariantTokens> = {
  primary:     { bg: TatvaColors.brandPrimary,    fg: TatvaColors.contentInverse },
  secondary:   { bg: TatvaColors.surfaceSecondary, fg: TatvaColors.contentPrimary, border: TatvaColors.borderSecondary },
  destructive: { bg: TatvaColors.dangerContent,   fg: TatvaColors.contentInverse },
  outline:     { bg: 'transparent',                fg: TatvaColors.contentPrimary, border: TatvaColors.borderTertiary },
  ghost:       { bg: 'transparent',                fg: TatvaColors.contentPrimary },
  inverse:     { bg: TatvaColors.surfaceSecondary, fg: TatvaColors.brandPrimary },
  indigo:      { bg: TatvaColors.indigoSurface,   fg: TatvaColors.contentInverse },
};

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  width = 'fit',
  isLoading,
  disabled,
  leftIcon,
  rightIcon,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const tokens = VARIANTS[variant];
  const isInert = disabled || isLoading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isInert}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || children}
      style={[
        styles.shell,
        {
          backgroundColor: tokens.bg,
          height: SIZE_HEIGHT[size],
          paddingHorizontal: SIZE_PADDING[size],
          borderColor: tokens.border ?? 'transparent',
          borderWidth: tokens.border ? StyleSheet.hairlineWidth : 0,
          alignSelf: width === 'full' ? 'stretch' : undefined,
          opacity: isInert && !isLoading ? 0.5 : 1,
        },
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={tokens.fg} />
      ) : (
        <>
          {leftIcon}
          <AppText
            style={{
              color: tokens.fg,
              fontSize: SIZE_FONT[size],
              fontWeight: Weight.semibold,
            }}
          >
            {children}
          </AppText>
          {rightIcon}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing['3'],
    borderRadius: Radius.md,
  },
});
