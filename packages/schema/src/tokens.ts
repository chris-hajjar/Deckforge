/**
 * tokens.ts — the design-token vocabulary.
 *
 * Styles in the deck tree reference tokens BY NAME ("accent", "surface"),
 * never raw values. Themes are token sets; registering a brand = overriding
 * token values on a base theme. The auto-correction engine snaps any raw
 * value the AI (or a human) sneaks in back to the nearest token.
 */
import { z } from "zod";

/** Color roles every theme must define. */
export const COLOR_ROLES = [
  "background", // slide background
  "surface", // primary card/panel fill
  "surface-alt", // secondary panel fill
  "text-primary",
  "text-secondary",
  "accent", // brand accent (metric numbers, emphasis)
  "accent-alt",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Font stacks are constrained to metrics-known families (see docs/V2-ARCHITECTURE.md, Pillar A).
 * All three map to fonts built into both PowerPoint and Google Slides
 * (Arial, Georgia, Courier New). */
export const FONT_IDS = ["sans", "serif", "mono"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const FontIdSchema = z.enum(FONT_IDS);

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb hex");

export const ThemeTokensSchema = z
  .object({
    name: z.string(),
    colors: z.record(z.enum(COLOR_ROLES), HexColor),
    fonts: z.object({
      heading: FontIdSchema,
      body: FontIdSchema,
    }),
    /** Named font sizes in px on the 1280×720 canvas. */
    fontSizes: z.object({
      display: z.number(),
      h1: z.number(),
      h2: z.number(),
      body: z.number(),
      small: z.number(),
      metricValue: z.number(),
      metricLabel: z.number(),
    }),
    /** The only paddings/gaps allowed; auto-correct snaps to the nearest step. */
    spacingScale: z.array(z.number()).nonempty(),
    /** Allowed font sizes; free sizes snap to the nearest step. */
    fontSizeScale: z.array(z.number()).nonempty(),
    radius: z.object({ none: z.number(), sm: z.number(), md: z.number() }),
  })
  .strict();

export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

/** Per-deck brand overrides applied on top of a base theme. */
export const ThemeRefSchema = z
  .object({
    base: z.string(), // name of a registered theme, e.g. "corporate-bold"
    overrides: z
      .object({
        colors: z.partialRecord(z.enum(COLOR_ROLES), HexColor).optional(),
        fonts: z
          .object({ heading: FontIdSchema.optional(), body: FontIdSchema.optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ThemeRef = z.infer<typeof ThemeRefSchema>;
