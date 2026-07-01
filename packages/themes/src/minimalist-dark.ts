import type { ThemeTokens } from "@deckforge/schema";

/** Minimalist Dark — near-black surfaces, serif headings, restrained cyan accent. */
export const minimalistDark: ThemeTokens = {
  name: "minimalist-dark",
  colors: {
    background: "#0f1419",
    surface: "#1a222b",
    "surface-alt": "#232e3a",
    "text-primary": "#e8e6e3",
    "text-secondary": "#9aa7b4",
    accent: "#4ec9e8",
    "accent-alt": "#e8b44e",
  },
  fonts: { heading: "serif", body: "sans" },
  fontSizes: {
    display: 62,
    h1: 42,
    h2: 30,
    body: 21,
    small: 15,
    metricValue: 54,
    metricLabel: 14,
  },
  spacingScale: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],
  fontSizeScale: [12, 14, 15, 16, 18, 21, 24, 30, 36, 42, 54, 62, 76],
  radius: { none: 0, sm: 4, md: 10 },
  // Same eight hues stepped for the dark surface #0f1419 and validated as a
  // set: lightness band PASS, chroma PASS, contrast all ≥3:1 PASS; worst
  // adjacent CVD ΔE 10.3 (floor band) → secondary encoding required: the
  // renderer keeps 2px surface gaps between adjacent fills + direct labels.
  chartPalette: [
    "#3987e5", // blue
    "#199e70", // aqua
    "#c98500", // yellow
    "#008300", // green
    "#9085e9", // violet
    "#e66767", // red
    "#d55181", // magenta
    "#d95926", // orange
  ],
};
