import type { ThemeTokens } from "@deckforge/schema";

/** Corporate Bold — light, confident, saturated accent. */
export const corporateBold: ThemeTokens = {
  name: "corporate-bold",
  colors: {
    background: "#ffffff",
    surface: "#f4f6f8",
    "surface-alt": "#e8edf2",
    "text-primary": "#12181f",
    "text-secondary": "#5a6673",
    accent: "#0b62e4",
    "accent-alt": "#e4560b",
  },
  fonts: { heading: "sans", body: "sans" },
  fontSizes: {
    display: 64,
    h1: 44,
    h2: 32,
    body: 22,
    small: 16,
    metricValue: 56,
    metricLabel: 15,
  },
  spacingScale: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],
  fontSizeScale: [12, 14, 15, 16, 18, 20, 22, 26, 32, 38, 44, 56, 64, 80],
  radius: { none: 0, sm: 6, md: 12 },
};
