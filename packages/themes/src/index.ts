/**
 * @deckforge/themes — built-in theme token sets.
 * A theme is pure data conforming to ThemeTokensSchema. Brand registration
 * (deck.theme.overrides) layers on top via resolveTheme().
 */
import type { ThemeRef, ThemeTokens } from "@deckforge/schema";
import { ThemeTokensSchema } from "@deckforge/schema";
import { corporateBold } from "./corporate-bold.js";
import { minimalistDark } from "./minimalist-dark.js";

export const THEMES: Record<string, ThemeTokens> = {
  "corporate-bold": ThemeTokensSchema.parse(corporateBold),
  "minimalist-dark": ThemeTokensSchema.parse(minimalistDark),
};

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
