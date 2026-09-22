export const Colors = {
  bg:          '#080C12',
  bgCard:      '#0F1420',
  bgElevated:  '#141B2D',
  bgBorder:    '#1E2A3E',
  primary:     '#00D4FF',
  primaryGlow: 'rgba(0,212,255,0.08)',
  accent:      '#FF3B5C',
  accentGlow:  'rgba(255,59,92,0.08)',
  success:     '#00E676',
  successGlow: 'rgba(0,230,118,0.08)',
  warning:     '#FFAA00',
  textPrimary:   '#E8EDF5',
  textSecondary: '#7A8CA0',
  // Was #3D4F63 — 2.2–2.3:1 against the app's backgrounds, well below the
  // WCAG AA 4.5:1 minimum, on the token used for stat labels, section headers
  // and timestamps. #8496AC clears AA on bg (6.5) and cards (6.1) while
  // staying visibly quieter than textSecondary.
  textMuted:     '#8496AC',
  textOnPrimary: '#000D14',
  pinDot: '#1E2A3E',
  pinKey: '#0F1420',
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 6, md: 10, lg: 16, xl: 24, full: 999,
};

export const FontSize = {
  xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26,
};
