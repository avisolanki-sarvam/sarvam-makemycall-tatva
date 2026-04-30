/**
 * Ambient stub for `phosphor-react-native`.
 *
 * Why this file exists: the real package needs `npm install` (it pulls
 * `react-native-svg` as a peer). To keep `tsc --noEmit` green in CI and
 * during pre-install code review, we declare the icon components we
 * actually use as JSX-compatible React components. The shapes here are
 * a strict subset of the real types — when the package is installed,
 * its own published `.d.ts` files take precedence and this stub is
 * effectively shadowed.
 *
 * If you need a Phosphor icon that isn't listed below, add it here.
 * Once `npm install phosphor-react-native react-native-svg` has been
 * run, this file can be deleted entirely.
 */

declare module 'phosphor-react-native' {
  import type { ComponentType } from 'react';

  /**
   * Subset of the real `IconProps` — these are the props we actually pass
   * from the screens. `weight` accepts the six Phosphor variants; we
   * primarily use `'regular'` (1.5px stroke) and `'fill'` for emphasis.
   */
  export interface IconProps {
    size?: number | string;
    color?: string;
    weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
    mirrored?: boolean;
    style?: any;
    onPress?: () => void;
  }

  export type IconComponent = ComponentType<IconProps>;

  // Icons used by the Tatva fork. Phosphor v3 ships every icon under a
  // *Icon-suffixed name (the un-suffixed `House` etc are JSDoc-deprecated
  // aliases). We only declare the suffixed form here. Keep alphabetised.
  export const ArrowsClockwiseIcon: IconComponent;
  export const BellIcon: IconComponent;
  export const BriefcaseIcon: IconComponent;
  export const CaretRightIcon: IconComponent;
  export const ChatCircleTextIcon: IconComponent;
  export const CheckIcon: IconComponent;
  export const CheckCircleIcon: IconComponent;
  export const ClockIcon: IconComponent;
  export const GearIcon: IconComponent;
  export const HouseIcon: IconComponent;
  export const InfoIcon: IconComponent;
  export const LightningIcon: IconComponent;
  export const MegaphoneIcon: IconComponent;
  export const PaperPlaneTiltIcon: IconComponent;
  export const PhoneIcon: IconComponent;
  export const PhoneCallIcon: IconComponent;
  export const PhoneOutgoingIcon: IconComponent;
  export const PhoneSlashIcon: IconComponent;
  export const PlusIcon: IconComponent;
  export const QuestionIcon: IconComponent;
  export const SignOutIcon: IconComponent;
  export const StorefrontIcon: IconComponent;
  export const TranslateIcon: IconComponent;
  export const UsersIcon: IconComponent;
  export const WalletIcon: IconComponent;
  export const WhatsappLogoIcon: IconComponent;
  export const XCircleIcon: IconComponent;
}
