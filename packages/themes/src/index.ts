/**
 * @deckforge/themes — the theme registry.
 * Two themes ship built-in; custom design systems register into the same
 * registry at runtime (the server loads them from the project's library/
 * dir on boot), so validation, layout and export all resolve them uniformly.
 */
import type { ThemeRef, ThemeTokens } from "@deckforge/schema";
import { ThemeTokensSchema } from "@deckforge/schema";
import { corporateBold } from "./corporate-bold.js";
import { minimalistDark } from "./minimalist-dark.js";

export const BUILTIN_THEMES = ["corporate-bold", "minimalist-dark"] as const;

export const THEMES: Record<string, ThemeTokens> = {
  "corporate-bold": ThemeTokensSchema.parse(corporateBold),
  "minimalist-dark": ThemeTokensSchema.parse(minimalistDark),
};

/** Register (or replace) a custom theme. Throws if the tokens are invalid. */
export function registerTheme(tokens: unknown): ThemeTokens {
  const parsed = ThemeTokensSchema.parse(tokens);
  THEMES[parsed.name] = parsed;
  return parsed;
}

/** Deep-partial of ThemeTokens for building a design system on a base. */
export interface ThemePatch {
  name: string;
  colors?: Partial<ThemeTokens["colors"]>;
  fonts?: Partial<ThemeTokens["fonts"]>;
  fontSizes?: Partial<ThemeTokens["fontSizes"]>;
  radius?: Partial<ThemeTokens["radius"]>;
  spacingScale?: ThemeTokens["spacingScale"];
  fontSizeScale?: ThemeTokens["fontSizeScale"];
  chartPalette?: ThemeTokens["chartPalette"];
}

/**
 * Build a full theme by layering a patch over a base — the "easy design
 * system setup": a brand only needs its colors/fonts; scales, radii and the
 * validated chart palette inherit from the base unless replaced.
 */
export function mergeTheme(base: ThemeTokens, patch: ThemePatch): ThemeTokens {
  return ThemeTokensSchema.parse({
    ...base,
    name: patch.name,
    colors: { ...base.colors, ...(patch.colors ?? {}) },
    fonts: { ...base.fonts, ...(patch.fonts ?? {}) },
    fontSizes: { ...base.fontSizes, ...(patch.fontSizes ?? {}) },
    radius: { ...base.radius, ...(patch.radius ?? {}) },
    spacingScale: patch.spacingScale ?? base.spacingScale,
    fontSizeScale: patch.fontSizeScale ?? base.fontSizeScale,
    chartPalette: patch.chartPalette ?? base.chartPalette,
  });
}

export function resolveTheme(ref: ThemeRef): ThemeTokens {
  const base = THEMES[ref.base];
  if (!base) {
    throw new Error(
      `Unknown theme "${ref.base}". Available: ${Object.keys(THEMES).join(", ")}`,
    );
  }
  if (!ref.overrides) return base;
  return {
    ...base,
    colors: { ...base.colors, ...(ref.overrides.colors ?? {}) },
    fonts: { ...base.fonts, ...(ref.overrides.fonts ?? {}) },
  };
}

export { corporateBold, minimalistDark };
