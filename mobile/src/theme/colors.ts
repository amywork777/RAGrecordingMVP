export const colors = {
  // Modern purple-teal gradient theme
  primary: {
    light: '#8B5CF6', // Violet
    main: '#7C3AED',  // Purple
    dark: '#6D28D9',  // Deep Purple
  },
  secondary: {
    light: '#34D399', // Emerald
    main: '#10B981',  // Teal
    dark: '#059669',  // Deep Teal
  },
  background: {
    primary: '#0F0F1E',    // Almost black with purple tint
    secondary: '#1A1A2E',  // Dark navy
    elevated: '#252540',   // Elevated surface
    card: '#2D2D4A',      // Card background
  },
  text: {
    primary: '#FFFFFF',    // Pure white
    secondary: '#A0A0B8',  // Muted purple-gray
    disabled: '#6B6B80',   // Disabled state
    accent: '#E0AAFF',     // Light purple accent
  },
  accent: {
    gradient1: '#8B5CF6',  // Start of gradient
    gradient2: '#10B981',  // End of gradient
    error: '#EF4444',      // Red
    warning: '#F59E0B',    // Amber
    success: '#10B981',    // Green
  },
  surface: {
    backdrop: 'rgba(15, 15, 30, 0.95)',
    overlay: 'rgba(139, 92, 246, 0.1)',
    border: 'rgba(160, 160, 184, 0.2)',
  }
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const typography = {
  fontFamily: 'General Sans',
  h1: {
    fontSize: 32,
    fontWeight: '700' as const,
    fontFamily: 'General Sans',
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600' as const,
    fontFamily: 'General Sans',
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    fontFamily: 'General Sans',
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    fontFamily: 'General Sans',
    lineHeight: 24,
  },
  caption: {
    fontSize: 14,
    fontWeight: '400' as const,
    fontFamily: 'General Sans',
    lineHeight: 20,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontFamily: 'General Sans',
    letterSpacing: 0.5,
  },
};