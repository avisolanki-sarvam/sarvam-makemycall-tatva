/**
 * Button — Tatva `Button` primitive, ported to React Native.
 *
 * Mirrors the Tatva button spec from the MCP docs:
 *   variant: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'inverse' | 'indigo'
 *   size:    'sm' | 'md' | 'lg'   (heights: 32 / 40 / 48)
 *   width:   'full' | 'fit'
 *   isLoading, icon (left/right), iconPosition
 *
 * The historical `'indigo'` variant name is kept as a compatibility alias,
 * but it resolves through MakeMyCall's neutral/ink accent tokens.
 */

import { ReactNode } from 'react';
import {
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Radius, Spacing, Weight } from '../constants/theme';
import type { TatvaColorTokens } from '../constants/theme';
import { useAppTheme } from '../theme/AppThemeProvider';
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

function resolveButtonVariant(
  variant: ButtonVariant,
  colors: TatvaColorTokens,
): VariantTokens {
  switch (variant) {
    case 'secondary':
      return { bg: colors.surfaceSecondary, fg: colors.contentPrimary, border: colors.borderSecondary };
    case 'destructive':
      return { bg: colors.dangerContent, fg: colors.contentInverse };
    case 'outline':
      return { bg: 'transparent', fg: colors.contentPrimary, border: colors.borderTertiary };
    case 'ghost':
      return { bg: 'transparent', fg: colors.contentPrimary };
    case 'inverse':
      return { bg: colors.surfaceSecondary, fg: colors.brandPrimary };
    case 'indigo':
      return { bg: colors.indigoSurface, fg: colors.contentInverse };
    case 'primary':
    default:
      return { bg: colors.brandPrimary, fg: colors.contentInverse };
  }
}

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
  const { colors } = useAppTheme();
  const tokens = resolveButtonVariant(variant, colors);
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
