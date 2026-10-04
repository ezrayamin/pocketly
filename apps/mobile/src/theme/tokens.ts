/**
 * Design tokens from the Pocketly design system (dark theme).
 * Primary #00E599 · Secondary #10B981 · Tertiary #F59E0B · Neutral #090D16.
 * Light mode (NFR-A11Y-04) is not designed yet.
 */
export const colors = {
  background: '#090D16',
  surface: '#121824',
  surfaceRaised: '#1A2130',
  border: '#232B3A',
  textPrimary: '#F2F5F9',
  textSecondary: '#8B95A7',
  textMuted: '#5E687A',
  primary: '#00E599',
  primaryDim: 'rgba(0, 229, 153, 0.14)',
  onPrimary: '#03140D',
  secondary: '#10B981',
  tertiary: '#F59E0B',
  tertiaryDim: 'rgba(245, 158, 11, 0.16)',
  danger: '#F87171',
  dangerDim: 'rgba(248, 113, 113, 0.16)',
  skeleton: '#1C2433',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const type = {
  title: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '500' },
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  balance: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
} as const;
