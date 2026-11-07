export const ledgerColors = {
  bg: '#08090f',
  surface: '#11141f',
  surface2: '#1b1f29',
  surface3: '#242628',
  border: '#2d3039',
  borderLight: '#41434a',
  accent: '#ffd166',
  accentDim: 'rgba(255,209,102,0.14)',
  accentHot: '#ffb020',
  accentCream: '#fff7e4',
  success: '#20c875',
  successDim: 'rgba(32,200,117,0.14)',
  danger: '#ef4444',
  dangerDim: 'rgba(239,68,68,0.14)',
  warning: '#ffb020',
  text1: '#f7f3e3',
  text2: '#c8c7c0',
  text3: '#999ba3',
  info: '#60a5fa',
  infoDim: 'rgba(96,165,250,0.14)',
} as const;

export const ledgerRadius = {
  control: 12,
  card: 18,
  sheet: 24,
  pill: 999,
} as const;

export const ledgerSpacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const ledgerTypography = {
  display: 34,
  pageTitle: 26,
  sectionTitle: 16,
  body: 14,
  secondary: 12,
  caption: 10,
} as const;

export const ledgerElevation = {
  card: { boxShadow: '0 8px 24px rgba(0,0,0,0.24)' },
  accent: { boxShadow: '0 8px 28px rgba(255,176,32,0.14)' },
} as const;
