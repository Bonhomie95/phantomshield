/**
 * PhantomShield is dark-only — this hook just returns the color directly
 * from the flat Colors object. The old light/dark split is not used.
 */
import { Colors } from '@/constants/theme';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors,
) {
  // Always dark mode. If a component passes an override, use it.
  return props.dark ?? props.light ?? (Colors[colorName] as string);
}
