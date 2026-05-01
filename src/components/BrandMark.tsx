/**
 * BrandMark — the Saaras V3 motif from sarvam.ai.
 *
 * Path is verbatim from https://assets.sarvam.ai/assets/motifs/models/model-07.svg
 * (the canonical Sarvam motif). We render it in `react-native-svg`
 * with a configurable linear gradient so the same component can play
 * three roles:
 *
 *   - `saaras` — original Saaras V3 colours (red → light blue).
 *   - `gradient` — saffron → indigo, the Indus brand-mark gradient
 *     used on splash + welcome + verify-otp + the home top bar.
 *   - `indigo` — solid brand-primary (sidebar, dense chrome).
 *   - `mono` — single fill (override via `color`).
 *
 * The original SVG's filter (drop-shadow + inner highlight) is omitted
 * because RN's SVG runtime doesn't support `<feGaussianBlur>` — the
 * mark is small enough that the highlight wouldn't read on phone anyway.
 *
 * The original viewBox is 0 0 125 125. We pass it through unchanged so
 * the path coordinates match the source SVG byte-for-byte.
 */

import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { TatvaColors } from '../constants/theme';

export type BrandMarkVariant = 'saaras' | 'gradient' | 'indigo' | 'mono';

export interface BrandMarkProps {
  size?: number;
  variant?: BrandMarkVariant;
  /** Override fill colour for `mono` variant. Defaults to contentPrimary. */
  color?: string;
}

// The Saaras V3 path — copied verbatim from
// https://assets.sarvam.ai/assets/motifs/models/model-07.svg.
const SAARAS_PATH =
  'M46.974 35.157v.216l-.066-.039c-5.498-3.196-10.643-1.24-15.306.533-2.412.917-4.695 1.785-6.83 1.866-4.15.34-5.272-.186-5.272-.186s.623.362 2.957 4.222c1.136 2.165 1.538 4.778 1.952 7.467.757 4.919 1.553 10.09 6.946 13.226l.066.038-.186.108c-6.372 3.704-6.99 9.515-7.496 14.278-.178 1.676-.343 3.223-.74 4.502-1.523 4.916-3.499 6.065-3.499 6.065s2.024-1.177 6.877.132c1.15.31 2.418.876 3.798 1.492 4.441 1.98 10.042 4.479 16.613.658l.186-.108v.077c0 6.393 4.255 9.902 8.111 13.082 1.995 1.645 3.883 3.201 5.02 5.024 2.368 3.448 2.475 4.69 2.475 4.69s0-.724 2.153-4.69c1.294-2.073 3.34-3.73 5.446-5.436 3.851-3.12 7.9-6.399 7.9-12.67v-.076l.186.107c6.372 3.705 11.678 1.339 16.028-.601 1.53-.683 2.943-1.313 4.241-1.607 4.989-1.129 6.966.02 6.966.02s-2.025-1.177-3.325-6.063c-.308-1.158-.456-2.547-.616-4.059-.517-4.863-1.169-10.996-7.74-14.817l-.186-.108.066-.038c5.498-3.197 6.388-8.662 7.195-13.615.417-2.562.812-4.987 1.81-6.89 1.782-3.79 2.796-4.504 2.796-4.504s-.623.362-5.11.468c-2.429-.092-4.878-1.048-7.397-2.031-4.609-1.8-9.454-3.691-14.847-.556l-.066.039v-.216c0-7.41-4.688-10.853-8.531-13.676-1.353-.994-2.6-1.91-3.503-2.896-3.465-3.787-3.465-6.085-3.465-6.085s0 2.354-3.552 5.93c-.842.849-1.963 1.672-3.183 2.568-3.923 2.882-8.872 6.517-8.872 14.16Z';

export function BrandMark({
  size = 96,
  variant = 'gradient',
  color,
}: BrandMarkProps) {
  // Resolve the fill: gradient variants reference url(#gradId), solid
  // variants pass the colour directly to the path's fill.
  const isGradient = variant === 'saaras' || variant === 'gradient';
  const monoFill =
    variant === 'mono'
      ? color || TatvaColors.contentPrimary
      : variant === 'indigo'
      ? TatvaColors.brandPrimary
      : undefined;

  // Stop colours per variant. `saaras` matches the source SVG exactly
  // (see paint0_linear_6671_15955 in model-07.svg). `gradient` is our
  // brand expression — saffron at top, indigo at bottom.
  const [stopTop, stopBottom] = (() => {
    switch (variant) {
      case 'saaras':
        return ['#B81514', '#D2DFF9'];
      case 'gradient':
      default:
        return [TatvaColors.saffronStart, TatvaColors.brandPrimary];
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 125 125">
      {isGradient ? (
        <Defs>
          <LinearGradient id="bm" x1="62.5" y1="30.341" x2="62.5" y2="112.72" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor={stopTop} />
            <Stop offset="97.6%" stopColor={stopBottom} />
          </LinearGradient>
        </Defs>
      ) : null}
      <Path d={SAARAS_PATH} fill={isGradient ? 'url(#bm)' : monoFill} />
    </Svg>
  );
}
