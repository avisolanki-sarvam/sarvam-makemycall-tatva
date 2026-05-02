/**
 * Input — Tatva `Input` primitive, ported to React Native.
 *
 * Mirrors the Tatva `Input` API from the MCP docs:
 *   label?, error?, helperText?, icon?, prefix?, size? ('sm'|'md'|'lg')
 * plus the underlying RN TextInput props (value, onChangeText, etc.).
 *
 * Sizes (heights match Tatva exactly so a designer can hand off in pixels):
 *   sm = 36px (default, dense screens)
 *   md = 44px (login / signup / form-heavy)
 *   lg = 54px (rare hero, e.g. a single-input onboarding screen)
 *
 * States (border + content tone resolve via the Tatva token set):
 *   - default    : surface-secondary fill, border-secondary outline
 *   - focused    : border-tertiary outline (no shadow ring — RN can't
 *                  do the web focus ring cheaply)
 *   - error      : danger border + danger helper line below
 *   - disabled   : background-secondary fill, content-quaternary text
 *
 * Composition rules from the spec we honor:
 *   - `icon` is always leading; an icon-only Input has no children.
 *   - `prefix` is string-only.
 *   - When `error` is set the helperText is suppressed in favour of
 *     the error message — same as Tatva web.
 */

import { useMemo, useState, useRef, forwardRef } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  Pressable,
} from 'react-native';
import {
  MagnifyingGlassIcon,
  XCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  IconProps,
} from 'phosphor-react-native';
import { Radius, Type, Weight, Spacing } from '../constants/theme';
import { useAppTheme } from '../theme/AppThemeProvider';
import { AppText } from './AppText';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  helperText?: string;
  prefix?: string;
  size?: InputSize;
  /** Optional leading icon. Pass a phosphor-react-native component. */
  leadingIcon?: React.ComponentType<IconProps>;
  /** Optional right slot (e.g. a clear button, voice mic). */
  rightSlot?: React.ReactNode;
  /** Render a built-in clear (×) button when value is non-empty. */
  showClear?: boolean;
  onClear?: () => void;
  /** When type=password, render show/hide toggle. */
  isPassword?: boolean;
  /** Outer container style override. */
  containerStyle?: ViewStyle;
}

// Pill heights — Indus uses generous touch targets; we bump md to 52
// (vs Tatva web's 44) so the pill silhouette reads at phone scale.
const SIZE_HEIGHT: Record<InputSize, number> = { sm: 40, md: 52, lg: 60 };
// Pill horizontal padding is always larger than the rectangular variant
// so the rounded ends don't crowd the text.
const SIZE_PADDING: Record<InputSize, number> = { sm: 16, md: 20, lg: 24 };
const SIZE_FONT: Record<InputSize, number> = { sm: 14, md: 16, lg: 17 };

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    helperText,
    prefix,
    size = 'md',
    leadingIcon: LeadingIcon,
    rightSlot,
    showClear,
    onClear,
    isPassword,
    containerStyle,
    onFocus,
    onBlur,
    value,
    secureTextEntry,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [pwdHidden, setPwdHidden] = useState(true);
  const innerRef = useRef<TextInput>(null);
  const { colors } = useAppTheme();

  // The visual border colour tracks state: error > focus > rest.
  const borderColor = useMemo(() => {
    if (error) return colors.dangerBorder;
    if (focused) return colors.borderTertiary;
    return colors.borderSecondary;
  }, [colors, error, focused]);

  const helper = error || helperText;
  const helperTone = error ? 'danger' : 'tertiary';

  return (
    <View style={[{ gap: Spacing['2'] }, containerStyle]}>
      {label ? (
        <AppText variant="label-md" tone="secondary" style={styles.label}>
          {label}
        </AppText>
      ) : null}

      <Pressable
        onPress={() => innerRef.current?.focus()}
        style={[
          styles.shell,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor,
            height: SIZE_HEIGHT[size],
            paddingHorizontal: SIZE_PADDING[size],
          },
        ]}
      >
        {LeadingIcon ? (
          <LeadingIcon size={16} color={colors.contentTertiary} weight="regular" />
        ) : null}

        {prefix ? (
          <AppText
            variant="body-sm"
            tone="tertiary"
            style={{ marginRight: 4 }}
          >
            {prefix}
          </AppText>
        ) : null}

        <TextInput
          ref={(r) => {
            innerRef.current = r;
            if (typeof ref === 'function') ref(r);
            else if (ref) (ref as any).current = r;
          }}
          style={[
            styles.input,
            { color: colors.contentPrimary, fontSize: SIZE_FONT[size] },
          ]}
          placeholderTextColor={colors.contentQuaternary}
          value={value}
          secureTextEntry={isPassword ? pwdHidden : secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />

        {/* Right slot order: explicit slot > password toggle > clear button. */}
        {rightSlot ? (
          rightSlot
        ) : isPassword ? (
          <TouchableOpacity
            onPress={() => setPwdHidden((v) => !v)}
            hitSlop={8}
            accessibilityLabel={pwdHidden ? 'Show password' : 'Hide password'}
          >
            {pwdHidden ? (
              <EyeIcon size={16} color={colors.contentTertiary} weight="regular" />
            ) : (
              <EyeSlashIcon size={16} color={colors.contentTertiary} weight="regular" />
            )}
          </TouchableOpacity>
        ) : showClear && value ? (
          <TouchableOpacity onPress={onClear} hitSlop={8} accessibilityLabel="Clear">
            <XCircleIcon size={16} color={colors.contentTertiary} weight="fill" />
          </TouchableOpacity>
        ) : null}
      </Pressable>

      {helper ? (
        <AppText variant="body-xs" tone={helperTone} style={styles.helper}>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
});

/**
 * SearchBar — Tatva search-input pattern.
 *
 * Sugar over `Input` with a leading magnifying-glass icon and built-in
 * clear button. Use this for any "filter / find" surface — contacts list,
 * agents list, command palette.
 */
export interface SearchBarProps
  extends Omit<InputProps, 'leadingIcon' | 'showClear' | 'isPassword'> {
  onClear?: () => void;
}

export function SearchBar({
  placeholder = 'Search',
  value,
  onChangeText,
  onClear,
  size = 'md',
  ...rest
}: SearchBarProps) {
  return (
    <Input
      placeholder={placeholder}
      value={value}
      onChangeText={onChangeText}
      leadingIcon={MagnifyingGlassIcon}
      showClear
      onClear={() => {
        onClear?.();
        onChangeText?.('');
      }}
      size={size}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  label: {
    fontWeight: Weight.medium,
  },
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['4'],
    // Indus default: pill silhouette across every input.
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    fontWeight: Weight.regular,
    // Tatva uses a slightly tighter line on inputs vs. body. Match it.
    lineHeight: Type.bodyMd.lineHeight,
  },
  helper: {
    paddingHorizontal: 2,
  },
});
