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

/** A brand asset (URL or data: URL); usable on slides via image elements. */
export const LogoSchema = z
  .object({
    name: z.string(),
    src: z.string(),
    usage: z.enum(["primary", "mark", "light-bg", "dark-bg"]).optional(),
  })
  .strict();
export type Logo = z.infer<typeof LogoSchema>;

/**
 * The non-visual half of a design system: what the brand IS and how it
 * speaks. The AI reads this from get_design_system, so generated copy —
 * not just colors — follows the brand.
 */
export const BrandSchema = z
  .object({
    tagline: z.string().optional(),
    description: z.string().optional(),
    audience: z.string().optional(),
    voice: z
      .object({
        tone: z.string().optional(), // e.g. "confident, plain-spoken, no hype"
        personality: z.array(z.string()).optional(),
        dos: z.array(z.string()).optional(),
        donts: z.array(z.string()).optional(),
        preferredTerms: z.array(z.string()).optional(),
        avoidTerms: z.array(z.string()).optional(),
        exampleCopy: z.string().optional(),
      })
      .strict()
      .optional(),
    logos: z.array(LogoSchema).optional(),
    imagery: z
      .object({
        style: z.string().optional(), // e.g. "documentary photography, no stock clichés"
        guidance: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Brand = z.infer<typeof BrandSchema>;

export const ThemeTokensSchema = z
  .object({
    name: z.string(),
    /** Brand identity, voice and assets — optional but strongly encouraged. */
    brand: BrandSchema.optional(),
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
    /**
     * Categorical chart series colors, fixed order, assigned in sequence and
     * never cycled (slot order is the colorblind-safety mechanism). Each
     * theme's palette is validated against its surfaces with the dataviz
     * six-checks validator — see docs/CHART-PALETTES.md.
     */
    chartPalette: z.array(HexColor).min(8),
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
