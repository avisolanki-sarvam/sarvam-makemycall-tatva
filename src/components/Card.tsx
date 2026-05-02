/**
 * Card — Tatva `Card` primitive, ported to React Native.
 *
 * Mirrors the Tatva spec from the MCP docs:
 *   heading, description, image|src, badge, actions, topRightIcon,
 *   onPress, noBorder, direction ('horizontal'|'vertical'), size,
 *   clickable.
 *
 * Tatva web rule: Card does NOT render `children` — content comes
 * through props. We diverge slightly here to support the assistant-card
 * pattern where two action buttons sit BELOW the heading row (Test call
 * + Make My Call on the home screen). For that, an optional `footer`
 * prop accepts a render slot. Keeps the prop-driven discipline for the
 * 95% case while supporting the dual-CTA layout cleanly.
 *
 * Sizing — horizontal media:
 *   sm: 56×56  | md: 68×92 (default) | lg: 80×80
 *
 * Default radius is `lg` (20px) per the Tatva surface guidance — same
 * radius used on the home screen's existing month-stat card.
 */

import { ReactNode } from 'react';
import {
  View,
  TouchableOpacity,
  Image,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native';
import { Radius, Spacing, Shadow } from '../constants/theme';
import type { TatvaColorTokens } from '../constants/theme';
import { useAppTheme } from '../theme/AppThemeProvider';
import { AppText } from './AppText';

export type CardSize = 'sm' | 'md' | 'lg';
export type CardDirection = 'horizontal' | 'vertical';

export interface CardBadge {
  label: string;
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'indigo';
}

export interface CardProps {
  heading: string;
  description?: string;
  /** Image source URI. Mutually exclusive with `image`. */
  src?: string;
  /** Custom image / avatar element. Takes precedence over `src`. */
  image?: ReactNode;
  badge?: CardBadge;
  /** Right-side chevron icon. Set false to hide on clickable cards. */
  showChevron?: boolean;
  /** Optional footer slot (e.g. action buttons row). */
  footer?: ReactNode;
  noBorder?: boolean;
  direction?: CardDirection;
  size?: CardSize;
  onPress?: () => void;
  /** Force pressable visuals without onPress (e.g. controlled w/ longPress). */
  clickable?: boolean;
  /** Outer container style override. */
  style?: ViewStyle;
  /** Accessibility label for the pressable surface. */
  accessibilityLabel?: string;
}

const HORIZONTAL_MEDIA_SIZE: Record<CardSize, { w: number; h: number }> = {
  sm: { w: 56, h: 56 },
  md: { w: 68, h: 92 },
  lg: { w: 80, h: 80 },
};

const VERTICAL_MEDIA_SIZE: Record<CardSize, number> = {
  sm: 56,
  md: 80,
  lg: 0, // lg vertical is full-bleed, computed at render time
};

function resolveBadgeTone(
  tone: NonNullable<CardBadge['tone']>,
  colors: TatvaColorTokens,
): { bg: string; fg: string } {
  switch (tone) {
    case 'positive': return { bg: colors.positiveBackground, fg: colors.positiveContent };
    case 'warning': return { bg: colors.warningBackground, fg: colors.warningContent };
    case 'danger': return { bg: colors.dangerBackground, fg: colors.dangerContent };
    case 'indigo': return { bg: colors.indigoBackground, fg: colors.indigoContent };
    case 'default':
    default:
      return { bg: colors.backgroundTertiary, fg: colors.contentSecondary };
  }
}

export function Card({
  heading,
  description,
  src,
  image,
  badge,
  showChevron,
  footer,
  noBorder,
  direction = 'horizontal',
  size = 'md',
  onPress,
  clickable,
  style,
  accessibilityLabel,
}: CardProps) {
  const { colors } = useAppTheme();
  const isPressable = clickable || !!onPress;
  // Show chevron by default on clickable horizontal cards, off otherwise.
  const renderChevron = showChevron ?? (isPressable && direction === 'horizontal');
  const badgeTone = badge ? resolveBadgeTone(badge.tone || 'default', colors) : null;

  // Resolve the media slot. `image` wins over `src` (matches Tatva).
  const mediaNode = image ? (
    <View style={styles.mediaWrap}>{image}</View>
  ) : src ? (
    <Image
      source={{ uri: src }}
      style={
        direction === 'horizontal'
          ? {
              width: HORIZONTAL_MEDIA_SIZE[size].w,
              height: HORIZONTAL_MEDIA_SIZE[size].h,
              borderRadius: Radius.sm,
            }
          : {
              width: '100%',
              aspectRatio: 1,
              borderRadius: Radius.md,
            }
      }
    />
  ) : null;

  const Inner = (
    <View
      style={[
        styles.shell,
        { backgroundColor: colors.surfaceSecondary },
        noBorder
          ? null
          : {
              borderColor: colors.borderSecondary,
              borderWidth: StyleSheet.hairlineWidth,
            },
        direction === 'horizontal' ? styles.horizontal : styles.vertical,
        style,
      ]}
    >
      {mediaNode ? <View>{mediaNode}</View> : null}

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="heading-sm" numberOfLines={1}>
              {heading}
            </AppText>
            {description ? (
              <AppText
                variant="body-sm"
                tone="secondary"
                numberOfLines={2}
                style={styles.description}
              >
                {description}
              </AppText>
            ) : null}
          </View>

          {badge ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: badgeTone?.bg },
              ]}
            >
              <AppText
                variant="label-sm"
                style={{ color: badgeTone?.fg }}
              >
                {badge.label}
              </AppText>
            </View>
          ) : null}

          {renderChevron ? (
            <CaretRightIcon
              size={16}
              color={colors.contentTertiary}
              weight="regular"
            />
          ) : null}
        </View>

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </View>
  );

  if (!isPressable) return Inner;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {Inner}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: Radius.lg,
    padding: Spacing['8'],
    ...Shadow.l1,
  },
  horizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['6'],
  },
  vertical: {
    gap: Spacing['5'],
  },
  body: {
    flex: 1,
    gap: Spacing['5'],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['4'],
  },
  description: {
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: Spacing['4'],
    paddingVertical: Spacing['1'],
    borderRadius: Radius.full,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing['4'],
  },
  mediaWrap: {
    overflow: 'hidden',
    borderRadius: Radius.full,
  },
});
