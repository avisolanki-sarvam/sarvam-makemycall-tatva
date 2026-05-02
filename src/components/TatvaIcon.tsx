import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import {
  Add01Icon,
  AiMagicIcon,
  ArrowLeft01Icon,
  AudioBook01Icon,
  Camera02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ClipboardPasteIcon,
  Delete02Icon,
  LoaderPinwheelIcon,
  Mic01Icon,
  PencilEdit01Icon,
  SmartPhone01Icon,
  StopIcon,
  Tick02Icon,
  Upload01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import type { TatvaColorTokens } from '../constants/theme';
import { useAppTheme } from '../theme/AppThemeProvider';

const ICONS = {
  'arrow-left': ArrowLeft01Icon,
  'ai-magic': AiMagicIcon,
  'audio-book': AudioBook01Icon,
  camera: Camera02Icon,
  check: Tick02Icon,
  'check-circle': CheckmarkCircle02Icon,
  close: Cancel01Icon,
  'clipboard-paste': ClipboardPasteIcon,
  delete: Delete02Icon,
  edit: PencilEdit01Icon,
  loader: LoaderPinwheelIcon,
  microphone: Mic01Icon,
  plus: Add01Icon,
  smartphone: SmartPhone01Icon,
  stop: StopIcon,
  upload: Upload01Icon,
  users: UserMultipleIcon,
} satisfies Record<string, IconSvgElement>;

const SIZE = {
  xxs: 12,
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
  '2xl': 28,
  '3xl': 32,
} as const;

export type TatvaIconName = keyof typeof ICONS;
export type TatvaIconSize = keyof typeof SIZE;
export type TatvaIconTone =
  | 'primary'
  | 'brand'
  | 'brand-foreground'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'indigo'
  | 'inverse';

function resolveIconToneColor(tone: TatvaIconTone, colors: TatvaColorTokens): string {
  switch (tone) {
    case 'brand': return colors.brandContent;
    case 'brand-foreground': return colors.brandContentInverse;
    case 'secondary': return colors.contentSecondary;
    case 'tertiary': return colors.contentTertiary;
    case 'success': return colors.positiveContent;
    case 'warning': return colors.warningContent;
    case 'danger': return colors.dangerContent;
    case 'indigo': return colors.indigoContent;
    case 'inverse': return colors.contentInverse;
    case 'primary':
    default:
      return colors.contentPrimary;
  }
}

interface TatvaIconProps {
  name: TatvaIconName;
  size?: TatvaIconSize | number;
  tone?: TatvaIconTone;
  color?: string;
  strokeWidth?: number;
  spin?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function TatvaIcon({
  name,
  size = 'sm',
  tone = 'primary',
  color,
  strokeWidth = 2,
  spin = false,
  style,
}: TatvaIconProps) {
  const { colors } = useAppTheme();
  const icon = ICONS[name];
  const pixelSize = typeof size === 'number' ? size : SIZE[size];
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spin) {
      rotation.stopAnimation();
      rotation.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [rotation, spin]);

  const renderedIcon = (
    <HugeiconsIcon
      icon={icon}
      size={pixelSize}
      color={color ?? resolveIconToneColor(tone, colors)}
      strokeWidth={strokeWidth}
      style={spin ? undefined : style}
    />
  );

  if (spin) {
    const rotate = rotation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    return (
      <Animated.View style={[style, { transform: [{ rotate }] }]}>
        {renderedIcon}
      </Animated.View>
    );
  }

  return renderedIcon;
}
