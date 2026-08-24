export const theme = {
  colors: {
    background: "#101014",
    surface: "#1B1B1F",
    surfaceContainer: "#1E1E24",
    surfaceHighest: "#26262C",
    outline: "#3A3A43",
    outlineVariant: "#2A2A31",
    primary: "#A8C7FA",
    onPrimary: "#062E5F",
    primaryContainer: "#254377",
    onPrimaryContainer: "#D6E3FF",
    secondaryContainer: "#39424F",
    onSecondaryContainer: "#D8E2F5",
    error: "#FFB4AB",
    onError: "#690005",
    errorContainer: "#5C1A16",
    onSurface: "#E4E2EA",
    onSurfaceVariant: "#C4C6D0",
  },
  radius: {
    md: 12,
    lg: 20,
    xl: 28,
    full: 999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
} as const;

export type Theme = typeof theme;
