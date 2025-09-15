import { useColorScheme } from 'react-native';

// Base color palette from your design
const palette = {
  // Blue gradient colors from your image
  navy: '#0D2951',      // Darkest blue
  oceanBlue: '#076B8B',  // Medium-dark blue
  teal: '#52B9CA',       // Medium teal
  lightTeal: '#9CCBD3',  // Light teal
  cream: '#FFF6DC',      // Light cream
  paleYellow: '#FFF9E6', // Pale yellow

  // Additional colors
  white: '#FFFFFF',
  black: '#000000',
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
  
  // Status colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
};

// Dark theme
export const darkTheme = {
  primary: {
    light: palette.lightTeal,
    main: palette.teal,
    dark: palette.oceanBlue,
    darker: palette.navy,
  },
  secondary: {
    light: palette.cream,
    main: palette.paleYellow,
    dark: palette.lightTeal,
  },
  background: {
    primary: palette.navy,        // Main background
    secondary: '#0A1E3D',        // Slightly lighter navy
    elevated: '#114266',         // Elevated surfaces
    card: palette.oceanBlue,     // Card backgrounds
  },
  text: {
    primary: palette.white,
    secondary: palette.lightTeal,
    disabled: palette.gray[400],
    accent: palette.cream,
  },
  accent: {
    gradient1: palette.navy,
    gradient2: palette.teal,
    error: palette.error,
    warning: palette.warning,
    success: palette.success,
    info: palette.info,
  },
  surface: {
    backdrop: 'rgba(13, 41, 81, 0.95)',
    overlay: 'rgba(82, 185, 202, 0.1)',
    border: 'rgba(156, 203, 211, 0.2)',
  }
};

// Light theme
export const lightTheme = {
  primary: {
    light: palette.teal,
    main: palette.oceanBlue,
    dark: palette.navy,
    darker: '#051A3A',
  },
  secondary: {
    light: palette.paleYellow,
    main: palette.cream,
    dark: palette.lightTeal,
  },
  background: {
    primary: palette.white,
    secondary: palette.gray[50],
    elevated: palette.gray[100],
    card: `${palette.lightTeal}20`,
  },
  text: {
    primary: palette.navy,
    secondary: palette.oceanBlue,
    disabled: palette.gray[400],
    accent: palette.teal,
  },
  accent: {
    gradient1: palette.lightTeal,
    gradient2: palette.navy,
    error: palette.error,
    warning: palette.warning,
    success: palette.success,
    info: palette.info,
  },
  surface: {
    backdrop: 'rgba(255, 255, 255, 0.95)',
    overlay: 'rgba(13, 41, 81, 0.05)',
    border: 'rgba(13, 41, 81, 0.1)',
  }
};

// Hook to get current theme based on system preference
export const useTheme = () => {
  const colorScheme = useColorScheme();
  return colorScheme === 'dark' ? darkTheme : lightTheme;
};

// Default to dark theme for backwards compatibility
export const colors = darkTheme;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
};

export const shadows = {
  // Soft shadows for cards
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  // Medium shadows for buttons
  button: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  // Strong shadows for modals
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  // Subtle inset shadows
  inset: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
};

export const typography = {
  fontFamily: 'General Sans',
  // Display text for hero sections
  display: {
    fontSize: 36,
    fontWeight: '800' as const,
    fontFamily: 'General Sans',
    letterSpacing: -1,
    lineHeight: 42,
  },
  // Large headings
  h1: {
    fontSize: 28,
    fontWeight: '400' as const,
    fontFamily: 'General Sans',
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  // Section headings
  h2: {
    fontSize: 22,
    fontWeight: '400' as const,
    fontFamily: 'General Sans',
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  // Subsection headings
  h3: {
    fontSize: 18,
    fontWeight: '450' as const,
    fontFamily: 'General Sans',
    letterSpacing: -0.1,
    lineHeight: 24,
  },
  // Body text
  body: {
    fontSize: 16,
    fontWeight: '450' as const,
    fontFamily: 'General Sans',
    lineHeight: 24,
    letterSpacing: 0,
  },
  // Secondary body text
  bodySecondary: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'General Sans',
    lineHeight: 22,
    letterSpacing: 0,
  },
  // Small text
  caption: {
    fontSize: 13,
    fontWeight: '450' as const,
    fontFamily: 'General Sans',
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  // Micro text
  micro: {
    fontSize: 11,
    fontWeight: '500' as const,
    fontFamily: 'General Sans',
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  // Button text
  button: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'General Sans',
    letterSpacing: 0.2,
  },
  // Large button text
  buttonLarge: {
    fontSize: 16,
    fontWeight: '650' as const,
    fontFamily: 'General Sans',
    letterSpacing: 0,
  },
  // Font sizes for easy reference
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 16,
    xl: 18,
    xxl: 22,
  },
};