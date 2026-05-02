/**
 * GradientButton — circular gradient action button.
 *
 * The MakeMyCall signature on chat / login inputs: a circular button on
 * the right of a pill input with a warm-to-ink gradient and a single icon
 * at centre (arrow on auth, mic on chat).
 *
 * Sized via the `size` prop (defaults to 44px — matches Tatva button-md).
 * Disabled state collapses the gradient to the muted brand surface so
 * the user can tell at-a-glance that the input isn't ready.
 */

import { ReactNode } from 'react';
import { TouchableOpacity, ViewStyle, View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { useAppTheme } from '../theme/AppThemeProvider';

export interface GradientButtonProps {
  onPress?: () => void;
  size?: number;
  disabled?: boolean;
  gradientColors?: readonly [string, string];
  /** Icon node rendered at center. Pass a phosphor icon or any ReactNode. */
  children: ReactNode;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function GradientButton({
  onPress,
  size = 44,
  disabled,
  gradientColors,
  children,
  accessibilityLabel,
  style,
}: GradientButtonProps) {
  const { colors } = useAppTheme();
  const [startColor, endColor] = gradientColors || [colors.brandPrimary, colors.indigoSurface];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.shell,
        { width: size, height: size, borderRadius: size / 2 },
        disabled ? { opacity: 0.4 } : null,
        style,
      ]}
    >
      {/* Gradient layer — full-bleed circle behind the icon. */}
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox="0 0 44 44"
      >
        <Defs>
          <LinearGradient id="gradBtn" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={startColor} />
            <Stop offset="100%" stopColor={endColor} />
          </LinearGradient>
        </Defs>
        <Circle cx="22" cy="22" r="22" fill="url(#gradBtn)" />
      </Svg>

      <View style={styles.iconLayer}>{children}</View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
